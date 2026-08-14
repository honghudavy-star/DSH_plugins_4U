#!/usr/bin/env node
// wallpaper.mjs — 更换背景壁纸（@dsh-plugins/wallpaper）
//
// 用法:
//   dsh-plugins-wallpaper set <图片路径|预设名> [--opacity 0.3]   换壁纸
//   dsh-plugins-wallpaper list                                     列出内置预设
//   dsh-plugins-wallpaper off                                      关闭壁纸
//   dsh-plugins-wallpaper apply                                    应用当前设置（幂等）
//   dsh-plugins-wallpaper status                                   当前状态
//
// 原理：把壁纸图压缩成 JPEG → base64 内嵌进 DSH 主题客户端 bundle 注入的 CSS
// （body::before 全屏半透明浮层，pointer-events:none 不影响操作），
// 由 DSH 内置 HMR 自动热更新，无需重启、无需刷新。
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PREFIX = '[dsh-plugins/wallpaper]';
const MARKER_START = '/* DSH_WALLPAPER_MARKER_START */';
const MARKER_END = '/* DSH_WALLPAPER_MARKER_END */';
const PRESETS_DIR = join(HERE, 'presets');
const CONFIG_DIR = join(homedir(), '.dsh-plugins', 'wallpaper');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const TMP = join(homedir(), '.dsh-plugins', 'wallpaper', '.tmp');
const PLUGIN_ID = '@deepseek-ai/dsh-client-ui-theme';

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return null;
  }
}
function saveConfig(cfg) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function locateBundle() {
  const base = join(homedir(), '.npm', '_npx');
  if (!existsSync(base)) return null;
  const cands = [];
  for (const d of readdirSync(base)) {
    const p = join(base, d, 'node_modules', PLUGIN_ID, 'lib', 'client.js');
    if (existsSync(p)) cands.push(p);
  }
  cands.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return cands[0] ?? null;
}

function resolvePreset(name) {
  const p = join(PRESETS_DIR, `${name}.png`);
  return existsSync(p) ? p : null;
}

/** 图片 → 压缩后的 jpeg 文件（macOS 用 sips；其他平台直接用原图） */
function compressToJpeg(src) {
  mkdirSync(dirname(TMP), { recursive: true });
  const out = `${TMP}-${Date.now()}.jpg`;
  if (platform() === 'darwin') {
    try {
      execSync(`sips -Z 1920 -s format jpeg -s formatOptions 72 "${src}" --out "${out}" >/dev/null 2>&1`, { stdio: 'ignore' });
      if (existsSync(out)) return out;
    } catch {}
  }
  // 回退：原图（PNG/JPEG 均可被浏览器识别）
  return src;
}

function buildCss(imagePath, opacity) {
  const file = compressToJpeg(imagePath);
  const buf = readFileSync(file);
  const mime = file.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const b64 = buf.toString('base64');
  if (file !== imagePath) { try { execSync(`rm -f "${file}"`); } catch {} }
  return `body::before{content:"";position:fixed;inset:0;z-index:1;pointer-events:none;background:url("data:${mime};base64,${b64}") center/cover no-repeat;opacity:${opacity}}`;
}

function applyToBundle(css) {
  const target = locateBundle();
  if (!target) {
    console.error(`${PREFIX} 未找到 DSH 主题 bundle（${PLUGIN_ID}），请确认 DSH 已安装`);
    return false;
  }
  let src = readFileSync(target, 'utf8');
  const anchor = '\t\treturn module.exports;';
  if (src.indexOf(anchor) === -1) {
    console.error(`${PREFIX} bundle 结构变化（找不到注入点），请更新本包`);
    return false;
  }
  // 移除旧补丁
  const s0 = src.indexOf(MARKER_START);
  const e0 = src.indexOf(MARKER_END);
  if (s0 !== -1 && e0 !== -1 && s0 < e0) {
    src = src.slice(0, s0) + src.slice(e0 + MARKER_END.length);
  }
  if (css) {
    const block = `\n\t\t${MARKER_START}\n\t\t(function () {\n\t\t\ttry {\n\t\t\t\tif (typeof document !== "undefined" && !document.getElementById("dsh-wallpaper")) {\n\t\t\t\t\tvar style = document.createElement("style");\n\t\t\t\t\tstyle.id = "dsh-wallpaper";\n\t\t\t\t\tstyle.setAttribute("data-plugin", "${PLUGIN_ID}");\n\t\t\t\t\tstyle.textContent = ${JSON.stringify(css)};\n\t\t\t\t\tdocument.head.appendChild(style);\n\t\t\t\t}\n\t\t\t} catch (e) {}\n\t\t})();\n\t\t${MARKER_END}\n`;
    src = src.replace(anchor, block + anchor);
  }
  writeFileSync(target, src);
  return true;
}

function command() {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'status';

  if (cmd === 'list') {
    console.log(`${PREFIX} 内置预设:`);
    for (const f of readdirSync(PRESETS_DIR).filter((f) => f.endsWith('.png')).sort()) {
      console.log(`  ${f.replace('.png', '')}`);
    }
    return;
  }

  if (cmd === 'set') {
    const target = args[1];
    if (!target) {
      console.error(`${PREFIX} 用法: dsh-plugins-wallpaper set <图片路径|预设名> [--opacity 0.3]`);
      process.exitCode = 1;
      return;
    }
    const opacityIdx = args.indexOf('--opacity');
    const opacity = opacityIdx !== -1 ? Math.min(1, Math.max(0, Number(args[opacityIdx + 1] ?? 0.3))) : 0.3;
    const preset = resolvePreset(target);
    const source = preset ?? target;
    if (!existsSync(source)) {
      console.error(`${PREFIX} 找不到图片: ${target}（内置预设见: dsh-plugins-wallpaper list）`);
      process.exitCode = 1;
      return;
    }
    saveConfig({ source: preset ? `preset:${target}` : source, opacity });
    if (applyToBundle(buildCss(source, opacity))) {
      console.log(`${PREFIX} 壁纸已应用: ${preset ? `预设「${target}」` : source}（透明度 ${opacity}）`);
      console.log(`${PREFIX} DSH 内置 HMR 将自动热更新；浏览器未生效请刷新页面。`);
    }
    return;
  }

  if (cmd === 'off') {
    saveConfig({ source: null, opacity: 0.3 });
    if (applyToBundle(null)) {
      console.log(`${PREFIX} 壁纸已关闭`);
    }
    return;
  }

  if (cmd === 'apply') {
    const cfg = loadConfig();
    if (!cfg?.source) {
      // 首次安装：应用默认预设，让用户立刻看到效果
      const preset = resolvePreset('midnight');
      saveConfig({ source: 'preset:midnight', opacity: 0.3 });
      if (applyToBundle(buildCss(preset, 0.3))) console.log(`${PREFIX} 已应用默认壁纸「midnight」（可用 dsh-plugins-wallpaper set/list/off 调整）`);
      return;
    }
    const source = cfg.source.startsWith('preset:') ? resolvePreset(cfg.source.slice(7)) : cfg.source;
    if (!source || !existsSync(source)) {
      console.error(`${PREFIX} 壁纸文件不存在（${cfg.source}），可重新 set`);
      process.exitCode = 1;
      return;
    }
    if (applyToBundle(buildCss(source, cfg.opacity ?? 0.3))) console.log(`${PREFIX} 已应用当前壁纸设置`);
    return;
  }

  if (cmd === 'status') {
    const cfg = loadConfig();
    console.log(`${PREFIX} 当前壁纸: ${cfg?.source ? cfg.source : '（无，使用默认背景）'}${cfg?.source ? ` 透明度 ${cfg.opacity}` : ''}`);
    return;
  }

  console.error(`${PREFIX} 未知命令: ${cmd}\n用法见脚本头部注释`);
  process.exitCode = 1;
}

command();
