#!/usr/bin/env node
// patch-profile.mjs — 把「识图」写进 DSH web profile 配置（幂等）
// 管理 cordis.patch.yml 里的两处：
//   1) mcp-vision MCP 服务（luma-mcp，image_understand 工具）
//   2) system-prompt persona 增加“遇到图片标记必须调 image_understand”指令
// API 密钥不入库：优先复用已有配置 → 环境变量 SILICONFLOW_API_KEY → 交互输入。
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const PREFIX = '[dsh-plugins/vision]';
const DEFAULT_PROFILE = join(homedir(), '.dsh', 'profiles', 'web', 'cordis.patch.yml');
const VISION_MARKER = 'image_understand';

function yamlSingleQuoted(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findPluginItem(content, id) {
  const pattern = new RegExp(`^([ \\t]*)-\\s+id:\\s*${escapeRegExp(id)}[ \\t]*(?:#.*)?$`, 'm');
  const match = pattern.exec(content);
  if (!match) return null;
  const start = match.index;
  const indentLength = match[1].replaceAll('\t', '  ').length;
  let cursor = content.indexOf('\n', start);
  if (cursor === -1) return { start, end: content.length, block: content.slice(start), indent: match[1] };
  cursor += 1;

  while (cursor < content.length) {
    const nextNewline = content.indexOf('\n', cursor);
    const end = nextNewline === -1 ? content.length : nextNewline;
    const line = content.slice(cursor, end);
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const lineIndent = line.match(/^[ \t]*/)[0].replaceAll('\t', '  ').length;
      if (lineIndent <= indentLength) {
        return { start, end: cursor, block: content.slice(start, cursor), indent: match[1] };
      }
    }
    cursor = nextNewline === -1 ? content.length : nextNewline + 1;
  }
  return { start, end: content.length, block: content.slice(start), indent: match[1] };
}

function parseYamlScalar(value) {
  const scalar = value.trim();
  if (scalar.startsWith("'") && scalar.endsWith("'")) {
    return scalar.slice(1, -1).replaceAll("''", "'");
  }
  if (scalar.startsWith('"') && scalar.endsWith('"')) {
    try {
      return JSON.parse(scalar);
    } catch {
      return scalar.slice(1, -1);
    }
  }
  return scalar.replace(/\s+#.*$/, '').trim();
}

/** Extract an existing key without ever printing it. */
export function extractExistingKey(content) {
  const item = findPluginItem(content, 'mcp-vision');
  if (!item) return null;
  const match = /^[ \t]*SILICONFLOW_API_KEY:[ \t]*(.+)$/m.exec(item.block);
  return match ? parseYamlScalar(match[1]) : null;
}

async function promptKey() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return '';
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolvePrompt) => {
    rl.question(`${PREFIX} 请输入 SiliconFlow API Key（申请地址 https://platform.siliconflow.cn，回车跳过）: `, (answer) => {
      rl.close();
      resolvePrompt(answer.trim());
    });
  });
}

function mcpVisionItem(indent, lumaPath, key) {
  const scriptPath = join(lumaPath, 'build', 'index.js');
  return `${indent}- id: mcp-vision
${indent}  name: '@deepseek-ai/dsh-mcp-client'
${indent}  config:
${indent}    serverName: vision
${indent}    transport: stdio
${indent}    command: node
${indent}    args:
${indent}      - ${yamlSingleQuoted(scriptPath)}
${indent}    env:
${indent}      MODEL_PROVIDER: siliconflow
${indent}      SILICONFLOW_API_KEY: ${yamlSingleQuoted(key)}
${indent}      LUMA_ALLOW_ANY_PATH: '1'
${indent}      BASE_VISION_PROMPT: '你是图片分析助手：对截图做OCR时直接逐字输出文字；描述图片时客观简洁，不要编造。'
`;
}

function mcpVisionContainer(lumaPath, key) {
  return `# BEGIN @dsh-plugins/vision（由安装器管理）
# 识图：Luma MCP（SiliconFlow + DeepSeek-OCR，工具 image_understand）
- insert:
${mcpVisionItem('    ', lumaPath, key)}# END @dsh-plugins/vision

`;
}

export function updateMcpVision(content, lumaPath, key) {
  const item = findPluginItem(content, 'mcp-vision');
  if (!item) {
    return { content: mcpVisionContainer(lumaPath, key) + content, changed: true, added: true };
  }

  let block = item.block;
  const argsPattern = /^([ \t]*args:[ \t]*\r?\n)([ \t]*-[ \t]*)([^\r\n]+)$/m;
  if (!argsPattern.test(block)) {
    throw new Error('现有 mcp-vision 缺少 config.args，无法安全更新 luma 路径');
  }
  block = block.replace(
    argsPattern,
    (_whole, heading, prefix) => `${heading}${prefix}${yamlSingleQuoted(join(lumaPath, 'build', 'index.js'))}`,
  );

  const keyPattern = /^([ \t]*SILICONFLOW_API_KEY:[ \t]*)([^\r\n]+)$/m;
  if (keyPattern.test(block)) {
    block = block.replace(keyPattern, (_whole, prefix) => `${prefix}${yamlSingleQuoted(key)}`);
  } else {
    const envPattern = /^([ \t]*env:[ \t]*)$/m;
    const envMatch = envPattern.exec(block);
    if (!envMatch) throw new Error('现有 mcp-vision 缺少 config.env，无法安全写入 API Key');
    const keyIndent = `${envMatch[1].match(/^[ \t]*/)[0]}  `;
    block = block.replace(envPattern, `$1\n${keyIndent}SILICONFLOW_API_KEY: ${yamlSingleQuoted(key)}`);
  }

  const updated = content.slice(0, item.start) + block + content.slice(item.end);
  return { content: updated, changed: updated !== content, added: false };
}

const VISION_PERSONA_ADDON = `Image handling: this model is text-only and cannot see images directly. When a
user message contains an image attachment marker like [图片附件 path="..." ...],
the user pasted or attached that image. You MUST call the image_understand tool
(from the vision MCP server) with image_source set to that exact path and a prompt
reflecting the user's intent (or "describe/OCR this image" when the user gave no
specific question), then answer based on the tool result. Never invent image content
without calling the tool. If image_understand fails, report the error honestly.`;

export function ensureSystemPrompt(content) {
  const item = findPluginItem(content, 'system-prompt');
  if (!item) return { content, changed: false, reason: 'no system-prompt entry' };

  const personaMatch = /^([ \t]*)persona:[ \t]*>-[ \t]*$/m.exec(item.block);
  if (!personaMatch) return { content, changed: false, reason: 'no folded persona' };
  const personaIndent = personaMatch[1].replaceAll('\t', '  ').length;
  const headerEnd = item.block.indexOf('\n', personaMatch.index);
  let cursor = headerEnd === -1 ? item.block.length : headerEnd + 1;
  let scalarEnd = cursor;
  while (cursor < item.block.length) {
    const newline = item.block.indexOf('\n', cursor);
    const lineEnd = newline === -1 ? item.block.length : newline;
    const line = item.block.slice(cursor, lineEnd);
    if (line.trim()) {
      const lineIndent = line.match(/^[ \t]*/)[0].replaceAll('\t', '  ').length;
      if (lineIndent <= personaIndent) break;
      scalarEnd = newline === -1 ? lineEnd : newline + 1;
    }
    cursor = newline === -1 ? item.block.length : newline + 1;
  }

  const scalar = item.block.slice(headerEnd === -1 ? item.block.length : headerEnd + 1, scalarEnd);
  if (scalar.includes(VISION_MARKER)) {
    return { content, changed: false, reason: 'vision already in persona' };
  }

  const addonIndent = `${personaMatch[1]}  `;
  const addon = VISION_PERSONA_ADDON.split('\n').map((line) => addonIndent + line).join('\n');
  const prefix = item.block.slice(0, scalarEnd);
  const separator = prefix.endsWith('\n') ? '\n' : '\n\n';
  const block = prefix + separator + addon + '\n' + item.block.slice(scalarEnd);
  return {
    content: content.slice(0, item.start) + block + content.slice(item.end),
    changed: true,
  };
}

function atomicWrite(path, content, mode = 0o600) {
  const temp = join(dirname(path), `.${basename(path)}.tmp-${randomUUID()}`);
  const fd = openSync(temp, 'wx', mode);
  let failure;
  try {
    writeFileSync(fd, content, 'utf8');
    fsyncSync(fd);
  } catch (error) {
    failure = error;
  } finally {
    closeSync(fd);
  }
  if (failure) {
    rmSync(temp, { force: true });
    throw failure;
  }
  try {
    renameSync(temp, path);
    chmodSync(path, mode);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

function resolveProfileTarget(profile) {
  try {
    if (!lstatSync(profile).isSymbolicLink()) return profile;
  } catch (error) {
    if (error?.code === 'ENOENT') return profile;
    throw error;
  }

  try {
    return realpathSync(profile);
  } catch (error) {
    throw new Error(`profile 符号链接目标不可用: ${profile} (${error.message})`);
  }
}

async function main() {
  const profile = process.env.DSH_PROFILE_FILE || DEFAULT_PROFILE;
  const profileTarget = resolveProfileTarget(profile);
  const lumaPath = process.env.DSH_VISION_LUMA_DIR || join(homedir(), 'DSH', 'plugins', 'third-party', 'luma-mcp', 'package');
  const original = existsSync(profile) ? readFileSync(profile, 'utf8') : '';
  const existingKey = extractExistingKey(original);
  const key = process.env.SILICONFLOW_API_KEY || existingKey || (await promptKey());
  if (!key) throw new Error('未提供 API Key；请设置 SILICONFLOW_API_KEY 后重跑');

  const mcp = updateMcpVision(original, lumaPath, key);
  if (mcp.added) console.log(`${PREFIX} 已添加 mcp-vision 配置`);
  else if (mcp.changed) console.log(`${PREFIX} 已更新 mcp-vision 路径/配置（保留已有 API Key）`);
  else console.log(`${PREFIX} mcp-vision 路径/配置已是最新`);

  const persona = ensureSystemPrompt(mcp.content);
  if (persona.changed) console.log(`${PREFIX} 已在 persona 追加识图指令`);
  else if (persona.reason === 'no system-prompt entry') {
    console.log(`${PREFIX} 未找到 system-prompt 条目，跳过 persona 追加（agent 仍可手动调用 image_understand）`);
  } else if (persona.reason === 'no folded persona') {
    console.log(`${PREFIX} system-prompt 没有折叠 persona，跳过自动追加`);
  } else {
    console.log(`${PREFIX} persona 已有识图指令`);
  }

  const directory = dirname(profile);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  if (persona.content !== original) {
    const backup = `${profileTarget}.bak`;
    if (existsSync(profile)) atomicWrite(backup, original, 0o600);
    atomicWrite(profileTarget, persona.content, 0o600);
    console.log(`${PREFIX} 已原子写入: ${profile}${existsSync(backup) ? `（备份: ${backup}）` : ''}`);
  } else {
    if (existsSync(profile)) chmodSync(profileTarget, 0o600);
    console.log(`${PREFIX} 配置未变化: ${profile}`);
  }
  console.log(`${PREFIX} 注意：配置修改需重启 DSH（dsh web）后生效。`);
}

function canonicalPath(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

const isMain = process.argv[1] && canonicalPath(process.argv[1]) === canonicalPath(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((error) => {
    console.error(`${PREFIX} ${error.message}`);
    process.exitCode = 1;
  });
}
