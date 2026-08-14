#!/usr/bin/env node
/**
 * DSH 识图集成补丁重放脚本（幂等）
 * 运行：node apply-patches.mjs
 * 覆盖：luma-mcp（白名单全局化 + 魔数嗅探）、dsh-llm-deepseek（图片块压平）、
 *       dsh-host-apiproxy（受理门放行）。
 * 注意：可用 DSH_NPX_RUNTIME_DIR 显式指定当前 npm-exec 运行时；未指定时只在
 *       缓存中恰好存在一个完整运行时时自动选择，多候选会安全停止。
 */
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  commitPatchFiles,
  PatchPlanError,
  planPatchFiles,
  resolveNpxRuntime,
} from './lib/patch-engine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// npx 缓存根（npm exec 重建后路径的 hash 会变，脚本会扫描）
const NPM_NPX_ROOT = process.env.DSH_NPX_ROOT || join(homedir(), ".npm", "_npx");
// luma 运行时目录（由 install.mjs 部署，可通过环境变量覆盖）
const LUMA_DIR = process.env.DSH_VISION_LUMA_DIR
  || join(homedir(), "DSH", "plugins", "third-party", "luma-mcp", "package");
const LUMA = join(LUMA_DIR, "build", "image-processor.js");

let runtime;
try {
  runtime = resolveNpxRuntime({
    explicit: process.env.DSH_NPX_RUNTIME_DIR,
    root: NPM_NPX_ROOT,
  });
} catch (error) {
  console.error(`运行时选择失败：${error.message}`);
  process.exit(1);
}
console.log(`使用 DSH npm-exec 运行时: ${runtime.runtimeRoot} (${runtime.version})`);

const patchTargets = new Map();
function patchFile(path, label, pairs) {
  const target = patchTargets.get(path) ?? { path, label, patches: [] };
  for (const [oldText, newText, marker] of pairs) {
    target.patches.push({ label, oldText, newText, marker });
  }
  patchTargets.set(path, target);
}

const T = "\t";

/* ── Patch A+E: luma-mcp image-processor.js ─────────────────────────── */
patchFile(LUMA, "luma 白名单全局化", [[
  `    const allowedDirs = [process.cwd(), os.homedir()].map((dir) => path.normalize(dir).toLowerCase());
    const isAllowed = allowedDirs.some((dir) => realPath.toLowerCase().startsWith(dir));
    if (!isAllowed) {
        throw new Error("Access denied: image path is outside the allowed directory");
    }`,
  `    // DSH 本地补丁：默认只允许 cwd 与主目录；设置 LUMA_ALLOW_ANY_PATH=1 时放开到任意路径
    if (process.env.LUMA_ALLOW_ANY_PATH !== "1" && process.env.LUMA_ALLOW_ANY_PATH !== "true") {
        const allowedDirs = [process.cwd(), os.homedir()].map((dir) => path.normalize(dir).toLowerCase());
        const isAllowed = allowedDirs.some((dir) => realPath.toLowerCase().startsWith(dir));
        if (!isAllowed) {
            throw new Error("Access denied: image path is outside the allowed directory");
        }
    }`,
  "LUMA_ALLOW_ANY_PATH",
]]);
patchFile(LUMA, "luma 魔数嗅探(loadImageBuffer)", [[
  `    const buffer = await readFile(realPath);
    const mimeType = ensureSupportedMimeType(getMimeType(imageSource));
    return { buffer, mimeType };`,
  `    const buffer = await readFile(realPath);
    // DSH 本地补丁：优先用魔数嗅探结果，避免无扩展名文件（attachment 存储）被误判
    const mimeType = ensureSupportedMimeType(sniffMimeType(buffer) ?? getMimeType(imageSource));
    return { buffer, mimeType };`,
  "sniffMimeType(buffer) ??",
]]);
patchFile(LUMA, "luma 魔数嗅探(validateImageSource)", [[
  `        const ext = normalizedSource.toLowerCase().split(".").pop();
        if (!ext || !SUPPORTED_EXTENSIONS.includes(ext)) {
            throw new Error(\`Unsupported image format: \${ext}. Supported: \${SUPPORTED_EXTENSIONS.join(", ")}\`);
        }`,
  `        // DSH 本地补丁：无扩展名（attachment sha256 文件）时用魔数嗅探兜底
        const ext = normalizedSource.toLowerCase().split(".").pop();
        if (ext && SUPPORTED_EXTENSIONS.includes(ext)) {
            // 扩展名合法，通过
        } else {
            const handle = await open(normalizedSource, "r");
            try {
                const head = Buffer.alloc(12);
                await handle.read(head, 0, 12, 0);
                if (sniffMimeType(head) === null) {
                    throw new Error(\`Unsupported image format: \${ext || "unknown"}. Supported: \${SUPPORTED_EXTENSIONS.join(", ")}\`);
                }
            } finally {
                await handle.close();
            }
        }`,
  "sniffMimeType(head)",
]]);
patchFile(LUMA, "luma 魔数嗅探(helper+import)", [[
  `import { readFile, stat, realpath } from "fs/promises";`,
  `import { readFile, stat, realpath, open } from "fs/promises";`,
  'open } from "fs/promises"',
], [
  `        case "gif":
            return "image/gif";
        default:
            return "image/jpeg"; // 默认使用 jpeg
    }
}`,
  `        case "gif":
            return "image/gif";
        default:
            return "image/jpeg"; // 默认使用 jpeg
    }
}
/**
 * DSH 本地补丁：按文件头魔数嗅探真实 MIME。
 * attachment 持久化文件是裸 sha256 文件名（无扩展名），扩展名推断必然失败。
 */
function sniffMimeType(buffer) {
    if (!buffer || buffer.length < 12) return null;
    const b = buffer;
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
    return null;
}`,
  "function sniffMimeType",
]]);

/* ── Patch B: dsh-llm-deepseek ──────────────────────────────────────── */
const DS_FILE = join(runtime.scopeDir, "dsh-llm-deepseek", "lib", "index.js");
patchFile(DS_FILE, "deepseek 适配器图片压平", [[
  `import { CONTEXT_WINDOW_EXCEEDED_CODE, CallId, EMPTY_RESPONSE_CODE, LlmAdapter, LlmError, ProviderRequestId, QUOTA_EXCEEDED_CODE, ReasoningEffortId, RetryPolicySchema, assertUsableApiKey, attributionHeaders, contentHasImage, isContextWindowExceededError, isQuotaExceededError, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";`,
  `import { join } from "node:path";
import { CONTEXT_WINDOW_EXCEEDED_CODE, CallId, EMPTY_RESPONSE_CODE, LlmAdapter, LlmError, ProviderRequestId, QUOTA_EXCEEDED_CODE, ReasoningEffortId, RetryPolicySchema, assertUsableApiKey, attributionHeaders, contentHasImage, isContextWindowExceededError, isQuotaExceededError, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";`,
  'resolveDshHome } from "@deepseek-ai/dsh-home-paths"',
], [
  `/** Reject core image content before any text-flattening path can silently erase it. */
function assertTextOnly(blocks) {
	if (contentHasImage(blocks)) throw new LlmError("The DeepSeek chat-completions adapter does not support image content.", "UNSUPPORTED_CONTENT");
}`,
  `/**
* DSH 本地补丁：文本模型不支持原生图片输入。不再拒绝图片块，而是将其序列化为
* 可读文本标记，携带持久化附件路径（与 dsh-attachment-local 存储规则一致）：
*   <dshHome>/attachments/v1/objects/<sha256前2位>/<sha256>
* agent 看到标记后应调用 image_understand 工具识图。
*/
function serializeTextWithImages(blocks) {
	const out = [];
	for (const block of blocks) {
		if (block.type === "text") {
			out.push(block.text);
		} else if (block.type === "image" && block.attachment !== void 0 && block.attachment !== null) {
			const ref = block.attachment;
			// attachmentId 形如 "sha256:<64位hex>"，存储路径用纯 hex（去掉前缀）
			const rawId = String(ref.attachmentId ?? "");
			const hex = /^sha256:([a-f0-9]{64})$/.exec(rawId)?.[1] ?? rawId.replace(/^sha256:/, "");
			let marker = \`[图片附件 path="\${join(resolveDshHome(), "attachments", "v1", "objects", hex.slice(0, 2), hex)}"\`;
			if (ref.mediaType !== void 0) marker += \` mediaType="\${ref.mediaType}"\`;
			if (ref.name !== void 0 && ref.name !== "") marker += \` name="\${ref.name}"\`;
			marker += "]";
			out.push(marker);
		}
	}
	return out.join("");
}`,
  "function serializeTextWithImages",
], [
  // 修复：attachmentId 带 "sha256:" 前缀，存储路径须用纯 hex（旧版直接用了带前缀的 id）
  `\t\t} else if (block.type === "image" && block.attachment !== void 0 && block.attachment !== null) {
\t\t\tconst ref = block.attachment;
\t\t\tconst id = String(ref.attachmentId ?? "");
\t\t\tlet marker = \`[图片附件 path="\${join(resolveDshHome(), "attachments", "v1", "objects", id.slice(0, 2), id)}"\`;`,
  `\t\t} else if (block.type === "image" && block.attachment !== void 0 && block.attachment !== null) {
\t\t\tconst ref = block.attachment;
\t\t\t// attachmentId 形如 "sha256:<64位hex>"，存储路径用纯 hex（去掉前缀）
\t\t\tconst rawId = String(ref.attachmentId ?? "");
\t\t\tconst hex = /^sha256:([a-f0-9]{64})$/.exec(rawId)?.[1] ?? rawId.replace(/^sha256:/, "");
\t\t\tlet marker = \`[图片附件 path="\${join(resolveDshHome(), "attachments", "v1", "objects", hex.slice(0, 2), hex)}"\`;`,
  "hex.slice(0, 2), hex",
], [
  `	for (const message of messages) {
		assertTextOnly(message.content);
		if (message.role === "system") {
			wire.push({
				role: "system",
				content: flattenText(message.content)
			});
			continue;
		}`,
  `	for (const message of messages) {
		if (message.role === "system") {
			wire.push({
				role: "system",
				content: serializeTextWithImages(message.content)
			});
			continue;
		}`,
  "content: serializeTextWithImages(message.content)",
], [
  `		const text = flattenText(message.content);`,
  `		const text = serializeTextWithImages(message.content);`,
  "serializeTextWithImages(message.content)",
], [
  `content: flattenText(result.content) || "(no output)"`,
  `content: serializeTextWithImages(result.content) || "(no output)"`,
  "serializeTextWithImages(result.content)",
]]);

/* ── Patch C: dsh-host-apiproxy 受理门 ──────────────────────────────── */
const AP_FILE = join(runtime.scopeDir, "dsh-host-apiproxy", "lib", "index.js");
patchFile(AP_FILE, "apiproxy 受理门放行", [[
  `${T}${T}${T}${T}${T}${T}if (hasImage) {\n${T}${T}${T}${T}${T}${T}${T}const current = selectionFor(agent).current;\n${T}${T}${T}${T}${T}${T}${T}const modelInfo = await ctx.llm.resolveModelInfo(current.provider, current.model);\n${T}${T}${T}${T}${T}${T}${T}if (modelInfo.inputModalities !== void 0 && !modelInfo.inputModalities.includes("image")) return err(request, {\n${T}${T}${T}${T}${T}${T}${T}${T}code: "attachment-error",\n${T}${T}${T}${T}${T}${T}${T}${T}message: \`Model "\${current.model}" does not support image input.\`,\n${T}${T}${T}${T}${T}${T}${T}${T}details: { reason: "MODEL_DOES_NOT_SUPPORT_IMAGES" }\n${T}${T}${T}${T}${T}${T}${T}});\n${T}${T}${T}${T}${T}${T}}`,
  `${T}${T}${T}${T}${T}${T}// DSH 本地补丁：不再按 inputModalities 拒绝图片消息。\n${T}${T}${T}${T}${T}${T}// 文本模型（DeepSeek）由适配器把图片块压平为带路径的文本标记，agent 据此调用 image_understand 识图；\n${T}${T}${T}${T}${T}${T}// 多模态模型仍收到原始图片块。\n${T}${T}${T}${T}${T}${T}if (hasImage) {\n${T}${T}${T}${T}${T}${T}${T}void selectionFor(agent);\n${T}${T}${T}${T}${T}${T}}`,
  "不再按 inputModalities 拒绝图片消息",
]]);

/* 汇总：所有目标先在内存完成验证，确认无误后再事务写入。 */
try {
  const plan = planPatchFiles([...patchTargets.values()]);
  console.log(plan.results.join("\n"));
  commitPatchFiles(plan.writes);
  console.log("\n全部补丁就绪。修改对运行中的进程不生效，需重启 dsh web。");
} catch (error) {
  if (error instanceof PatchPlanError) console.error(error.results.join("\n"));
  console.error(`\n${error.message}`);
  process.exitCode = 1;
}
