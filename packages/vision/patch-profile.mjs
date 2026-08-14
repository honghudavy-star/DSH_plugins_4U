#!/usr/bin/env node
// patch-profile.mjs — 把「识图」写进 DSH web profile 配置（幂等）
// 管理 cordis.patch.yml 里的两处：
//   1) mcp-vision MCP 服务（luma-mcp，image_understand 工具）
//   2) system-prompt persona 增加"遇到图片标记必须调 image_understand"指令
// API 密钥不入库：优先复用已有配置 → 环境变量 SILICONFLOW_API_KEY → 交互输入。
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const PREFIX = '[dsh-plugins/vision]';
const PROFILE = process.env.DSH_PROFILE_FILE || join(homedir(), '.dsh', 'profiles', 'web', 'cordis.patch.yml');
const VISION_MARKER = 'image_understand';

/** 从已有 mcp-vision 配置中提取 API key（保留用户已有配置） */
function extractExistingKey(content) {
  const m = /id:\s*mcp-vision[\s\S]{0,1200}?SILICONFLOW_API_KEY:\s*['"]([^'"]+)['"]/.exec(content);
  return m ? m[1] : null;
}

async function promptKey() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${PREFIX} 请输入 SiliconFlow API Key（申请地址 https://platform.siliconflow.cn，回车跳过）: `, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

function mcpVisionBlock(lumaPath, key) {
  return `# ── 识图：Luma MCP（SiliconFlow + DeepSeek-OCR，文本模型看图）──────────
# 由 @dsh-plugins/vision 安装生成。工具：image_understand(image_source, prompt, task_type)
- insert:
    - id: mcp-vision
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: vision
        transport: stdio
        command: node
        args:
          - ${lumaPath}/build/index.js
        env:
          MODEL_PROVIDER: siliconflow
          SILICONFLOW_API_KEY: '${key}'
          # 放开 luma 本地路径白名单到全局（本地补丁，默认仅 cwd+主目录）
          LUMA_ALLOW_ANY_PATH: '1'
          # DeepSeek-OCR 对英文长提示词会返回空 content；本地已打补丁跳过 task addon，
          # 用简短中文 base prompt 约束输出
          BASE_VISION_PROMPT: '你是图片分析助手：对截图做OCR时直接逐字输出文字；描述图片时客观简洁，不要编造。'

`;
}

const VISION_PERSONA_ADDON = `Image handling: this model is text-only and cannot see images directly. When a
      user message contains an image attachment marker like [图片附件 path="..." ...],
      the user pasted or attached that image. You MUST call the image_understand tool
      (from the vision MCP server) with image_source set to that exact path and a prompt
      reflecting the user's intent (or "describe/OCR this image" when the user gave no
      specific question), then answer based on the tool result. Never invent image content
      without calling the tool. If image_understand fails, report the error honestly.`;

function ensureSystemPrompt(content) {
  // 找到 system-prompt 条目
  const idx = content.indexOf('- id: system-prompt');
  if (idx === -1) return { content, changed: false, reason: 'no system-prompt entry' };
  const seg = content.slice(idx);
  const endMatch = /\n- (?!id: system-prompt)/.exec(seg); // 下一个顶层条目
  const segLen = endMatch ? endMatch.index : seg.length;
  const block = seg.slice(0, segLen);
  if (block.includes(VISION_MARKER)) return { content, changed: false, reason: 'vision already in persona' };
  // persona 是 >- 折叠块：在折叠块末尾追加两行（缩进与 persona 行一致）
  const personaLine = block.split('\n').find((l) => l.includes('persona:'));
  const indent = (personaLine?.match(/^\s*/)?.[0] ?? '') + '  ';
  const addon = VISION_PERSONA_ADDON.split('\n').map((l) => indent + l.trimStart().replace(/^/, '')).join('\n');
  // 简单追加：在 persona 折叠块最后一行之后加两空行 + addon 行
  const newBlock = block + '\n' + addon;
  return { content: content.slice(0, idx) + newBlock + content.slice(idx + segLen), changed: true };
}

async function main() {
  const lumaPath = process.env.DSH_VISION_LUMA_DIR || '/Users/hungdavy/DSH/plugins/third-party/luma-mcp/package';
  let content = existsSync(PROFILE) ? readFileSync(PROFILE, 'utf8') : '';

  // 1) mcp-vision
  if (content.includes('id: mcp-vision')) {
    console.log(`${PREFIX} mcp-vision 已配置（保留现有配置，含已有 API Key）`);
  } else {
    let key = process.env.SILICONFLOW_API_KEY || extractExistingKey(content) || (await promptKey());
    if (!key) {
      console.error(`${PREFIX} 未提供 API Key，跳过 mcp-vision 配置（可设环境变量 SILICONFLOW_API_KEY 后重跑）`);
      process.exitCode = 1;
      return;
    }
    content = mcpVisionBlock(lumaPath, key) + content;
    console.log(`${PREFIX} 已添加 mcp-vision 配置（API Key 来自${process.env.SILICONFLOW_API_KEY ? '环境变量' : '你刚才的输入'}）`);
  }

  // 2) system-prompt persona
  const sp = ensureSystemPrompt(content);
  if (sp.changed) {
    content = sp.content;
    console.log(`${PREFIX} 已在 persona 追加识图指令`);
  } else if (sp.reason === 'no system-prompt entry') {
    console.log(`${PREFIX} 未找到 system-prompt 条目，跳过 persona 追加（agent 仍可手动调用 image_understand）`);
  } else {
    console.log(`${PREFIX} persona 已有识图指令`);
  }

  writeFileSync(PROFILE, content, 'utf8');
  console.log(`${PREFIX} 已写入: ${PROFILE}`);
  console.log(`${PREFIX} 注意：配置修改需重启 DSH（dsh web）后生效。`);
}

main();
