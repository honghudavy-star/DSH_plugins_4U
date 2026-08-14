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
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, platform, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PREFIX = '[dsh-plugins/wallpaper]';
const MARKER_START = '/* DSH_WALLPAPER_MARKER_START */';
const MARKER_END = '/* DSH_WALLPAPER_MARKER_END */';
const PRESETS_DIR = join(HERE, 'presets');
const CONFIG_DIR = join(homedir(), '.dsh-plugins', 'wallpaper');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const PLUGIN_ID = '@deepseek-ai/dsh-client-ui-theme';

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return null;
  }
}
function explicitBundle(runtimeDirectory) {
  const runtime = resolve(runtimeDirectory);
  const candidates = [
    ...(basename(runtime) === 'client.js' ? [runtime] : []),
    join(runtime, 'lib', 'client.js'),
    join(runtime, 'dsh-client-ui-theme', 'lib', 'client.js'),
    join(runtime, PLUGIN_ID, 'lib', 'client.js'),
    join(runtime, 'node_modules', PLUGIN_ID, 'lib', 'client.js'),
  ];
  const matches = [...new Set(candidates.filter(isRegularFile).map((candidate) => realpathSync(candidate)))];
  if (matches.length !== 1) {
    throw new Error(`DSH_NPX_RUNTIME_DIR 不是含唯一主题 bundle 的 DSH npm-exec 运行时: ${runtimeDirectory}`);
  }
  return matches[0];
}

export function locateBundle() {
  const explicit = process.env.DSH_NPX_RUNTIME_DIR?.trim();
  if (explicit) return explicitBundle(explicit);

  const base = join(homedir(), '.npm', '_npx');
  if (!existsSync(base)) return null;
  const candidates = new Map();
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(base, entry.name, 'node_modules', PLUGIN_ID, 'lib', 'client.js');
    if (isRegularFile(path)) candidates.set(realpathSync(path), path);
  }
  if (candidates.size === 0) return null;
  if (candidates.size > 1) {
    const choices = [...candidates.values()].sort().map((path) => `  - ${path}`).join('\n');
    throw new Error(
      `发现多个 DSH 主题 bundle，无法安全判断实际运行目标：\n${choices}\n` +
      '请设置 DSH_NPX_RUNTIME_DIR 显式指定当前 DSH npm-exec 运行时；已停止且未写入任何文件。',
    );
  }
  return [...candidates.keys()][0];
}

function resolvePreset(name) {
  const p = join(PRESETS_DIR, `${name}.png`);
  return isRegularFile(p) ? p : null;
}

function isRegularFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function requireRegularImage(path) {
  if (!isRegularFile(path)) {
    throw new Error(`不是可读取的普通图片文件: ${path}`);
  }
}

export function parseOpacity(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && value.trim() === '')) {
    throw new Error('透明度必须是 0 到 1 之间的数字');
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`透明度必须是 0 到 1 之间的数字，收到: ${value}`);
  }
  return Math.min(1, Math.max(0, number));
}

/** 图片 → CSS（macOS 用 sips 压缩；其他平台直接使用原图）。 */
export function buildCss(imagePath, opacity, options = {}) {
  requireRegularImage(imagePath);
  const osPlatform = options.osPlatform ?? platform();
  const tempParent = options.tempParent ?? tmpdir();
  const sipsCommand = options.sipsCommand ?? 'sips';
  let file = imagePath;
  let tempDir = null;

  if (osPlatform === 'darwin') {
    tempDir = mkdtempSync(join(tempParent, 'dsh-wallpaper-'));
    const out = join(tempDir, 'wallpaper.jpg');
    try {
      execFileSync(sipsCommand, ['-Z', '1920', '-s', 'format', 'jpeg', '-s', 'formatOptions', '72', imagePath, '--out', out], { stdio: 'ignore' });
      if (isRegularFile(out)) file = out;
    } catch {}
  }

  try {
    const buf = readFileSync(file);
    const mime = file.endsWith('.png') ? 'image/png' : 'image/jpeg';
    const b64 = buf.toString('base64');
    return `body::before{content:"";position:fixed;inset:0;z-index:1;pointer-events:none;background:url("data:${mime};base64,${b64}") center/cover no-repeat;opacity:${opacity}}`;
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}

/** 在目标文件同目录写入、同步并原子替换，任何失败都会清理临时文件。 */
export function atomicWriteFile(target, contents, options = {}) {
  const renameFile = options.renameFile ?? renameSync;
  const randomSuffix = options.randomSuffix ?? (() => randomBytes(12).toString('hex'));
  const mode = statSync(target).mode & 0o777;
  let fd;
  let tempPath;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    tempPath = join(dirname(target), `.${basename(target)}.dsh-wallpaper-${process.pid}-${randomSuffix()}.tmp`);
    try {
      fd = openSync(tempPath, 'wx', mode);
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      tempPath = undefined;
    }
  }
  if (fd === undefined || tempPath === undefined) {
    throw new Error(`无法为 ${target} 创建唯一临时文件`);
  }

  try {
    writeFileSync(fd, contents, 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameFile(tempPath, target);
    tempPath = undefined;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch {}
    }
    if (tempPath !== undefined) {
      try { unlinkSync(tempPath); } catch {}
    }
  }
}

function removeFileIfPresent(path) {
  if (!path) return;
  try { unlinkSync(path); } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function stageFileReplacement({ path, contents, mode }) {
  const existed = existsSync(path);
  if (existed && !statSync(path).isFile()) throw new Error(`事务目标不是普通文件: ${path}`);
  const fileMode = mode ?? (existed ? statSync(path).mode & 0o777 : 0o600);
  const suffix = randomBytes(12).toString('hex');
  const temp = join(dirname(path), `.${basename(path)}.dsh-wallpaper-${process.pid}-${suffix}.tmp`);
  const backup = existed ? `${temp}.backup` : null;
  let fd;
  try {
    fd = openSync(temp, 'wx', fileMode);
    writeFileSync(fd, contents, 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    if (backup) copyFileSync(path, backup);
    return { path, temp, backup, existed };
  } catch (error) {
    if (fd !== undefined) {
      try { closeSync(fd); } catch {}
    }
    try { removeFileIfPresent(temp); } catch {}
    try { removeFileIfPresent(backup); } catch {}
    throw error;
  }
}

/** Stage every file first, then commit; any later failure restores earlier files. */
export function commitFileTransaction(updates, { beforeCommit } = {}) {
  const staged = [];
  const committed = [];
  try {
    for (const update of updates) staged.push(stageFileReplacement(update));
    for (let index = 0; index < staged.length; index += 1) {
      const item = staged[index];
      beforeCommit?.(index, item);
      renameSync(item.temp, item.path);
      item.temp = null;
      committed.push(item);
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const item of [...committed].reverse()) {
      try {
        if (item.existed) {
          renameSync(item.backup, item.path);
          item.backup = null;
        } else {
          removeFileIfPresent(item.path);
        }
      } catch (rollbackError) {
        item.keepBackup = true;
        rollbackErrors.push(rollbackError);
      }
    }
    for (const item of staged) {
      try { removeFileIfPresent(item.temp); } catch {}
      if (!item.keepBackup) {
        try { removeFileIfPresent(item.backup); } catch {}
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], '壁纸事务提交失败，且回滚未完全成功');
    }
    throw error;
  }
  for (const item of staged) {
    try { removeFileIfPresent(item.backup); } catch {}
  }
}

function selectBundleTarget() {
  try {
    const target = locateBundle();
    if (!target) {
      console.error(`${PREFIX} 未找到 DSH 主题 bundle（${PLUGIN_ID}），请确认 DSH 已安装`);
      return null;
    }
    return target;
  } catch (error) {
    console.error(`${PREFIX} ${error.message}`);
    return null;
  }
}

function renderBundle(target, css) {
  let src = readFileSync(target, 'utf8');
  const anchor = '\t\treturn module.exports;';
  if (src.indexOf(anchor) === -1) {
    throw new Error('bundle 结构变化（找不到注入点），请更新本包');
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
  return src;
}

function applyToBundle(css) {
  const target = selectBundleTarget();
  if (!target) return false;
  try {
    atomicWriteFile(target, renderBundle(target, css));
  } catch (error) {
    console.error(`${PREFIX} 写入 bundle 失败: ${error.message}`);
    return false;
  }
  return true;
}

export function applyWallpaperState(css, config, options = {}) {
  const selected = options.bundleTarget ? realpathSync(options.bundleTarget) : selectBundleTarget();
  if (!selected) return false;
  const requestedConfigFile = options.configFile ?? CONFIG_FILE;
  try {
    mkdirSync(dirname(requestedConfigFile), { recursive: true });
    const configFile = existsSync(requestedConfigFile) ? realpathSync(requestedConfigFile) : requestedConfigFile;
    commitFileTransaction([
      { path: selected, contents: renderBundle(selected, css) },
      { path: configFile, contents: JSON.stringify(config, null, 2), mode: 0o600 },
    ], options.transactionOptions);
  } catch (error) {
    console.error(`${PREFIX} 写入 bundle/config 失败: ${error.message}`);
    return false;
  }
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
    let opacity;
    try {
      opacity = parseOpacity(opacityIdx !== -1 ? args[opacityIdx + 1] : 0.3);
    } catch (error) {
      console.error(`${PREFIX} ${error.message}`);
      process.exitCode = 1;
      return;
    }
    const preset = resolvePreset(target);
    const source = preset ?? target;
    if (!isRegularFile(source)) {
      console.error(`${PREFIX} 找不到普通图片文件: ${target}（内置预设见: dsh-plugins-wallpaper list）`);
      process.exitCode = 1;
      return;
    }
    const nextConfig = { source: preset ? `preset:${target}` : source, opacity };
    if (!applyWallpaperState(buildCss(source, opacity), nextConfig)) {
      process.exitCode = 1;
      return;
    }
    console.log(`${PREFIX} 壁纸已应用: ${preset ? `预设「${target}」` : source}（透明度 ${opacity}）`);
    console.log(`${PREFIX} DSH 内置 HMR 将自动热更新；浏览器未生效请刷新页面。`);
    return;
  }

  if (cmd === 'off') {
    if (!applyWallpaperState(null, { source: null, opacity: 0.3 })) {
      process.exitCode = 1;
      return;
    }
    console.log(`${PREFIX} 壁纸已关闭`);
    return;
  }

  if (cmd === 'apply') {
    const cfg = loadConfig();
    if (!cfg?.source) {
      // 首次安装：应用默认预设，让用户立刻看到效果
      const preset = resolvePreset('midnight');
      if (!applyWallpaperState(buildCss(preset, 0.3), { source: 'preset:midnight', opacity: 0.3 })) {
        process.exitCode = 1;
        return;
      }
      console.log(`${PREFIX} 已应用默认壁纸「midnight」（可用 dsh-plugins-wallpaper set/list/off 调整）`);
      return;
    }
    const source = typeof cfg.source === 'string' && cfg.source.startsWith('preset:') ? resolvePreset(cfg.source.slice(7)) : cfg.source;
    if (typeof source !== 'string' || !isRegularFile(source)) {
      console.error(`${PREFIX} 壁纸文件不存在（${cfg.source}），可重新 set`);
      process.exitCode = 1;
      return;
    }
    let opacity;
    try {
      opacity = parseOpacity(cfg.opacity === undefined ? 0.3 : cfg.opacity);
    } catch (error) {
      console.error(`${PREFIX} 配置无效: ${error.message}，请重新 set`);
      process.exitCode = 1;
      return;
    }
    if (!applyToBundle(buildCss(source, opacity))) {
      process.exitCode = 1;
      return;
    }
    console.log(`${PREFIX} 已应用当前壁纸设置`);
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

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) command();
