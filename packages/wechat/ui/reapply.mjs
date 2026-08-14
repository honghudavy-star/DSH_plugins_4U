#!/usr/bin/env node
// reapply.mjs — 把「微信入口」补丁应用到 DSH 客户端 bundle（幂等）。
//
// 用法:
//   npx dsh-plugins-wechat                 # 自动定位 bundle（~/.npm/_npx/*/...）
//   npx dsh-plugins-wechat <bundle路径>    # 指定路径
//
// 组件代码的权威来源是同目录 dsh-client-ui-workspace.client.js.patched，
// 本脚本从其中提取补丁块再拼接。改动后由 DSH 内置 client-hmr（500ms 轮询）自动热更新。
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PATCHED = join(HERE, 'dsh-client-ui-workspace.client.js.patched');
const MARKER = 'const WECHAT_SESSION_IDS';
const PREFIX = '[dsh-plugins/wechat]';

function locateBundle() {
  const base = join(homedir(), '.npm', '_npx');
  if (!existsSync(base)) return null;
  const cands = [];
  for (const d of readdirSync(base)) {
    const p = join(base, d, 'node_modules', '@deepseek-ai', 'dsh-client-ui-workspace', 'lib', 'client.js');
    if (existsSync(p)) cands.push(p);
  }
  cands.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return cands[0] ?? null;
}

function countOccurrences(s, sub) {
  let n = 0;
  let i = 0;
  while ((i = s.indexOf(sub, i)) !== -1) {
    n += 1;
    i += sub.length;
  }
  return n;
}

function main() {
  const target = process.argv[2] || locateBundle();
  if (!target) {
    console.error(`${PREFIX} 未找到 DSH workspace bundle。请手动指定: npx dsh-plugins-wechat <client.js 绝对路径>`);
    process.exit(0); // 不阻断 npm install，稍后可重跑
  }
  if (!existsSync(target)) {
    console.error(`${PREFIX} 文件不存在: ${target}`);
    process.exit(0);
  }

  let src = readFileSync(target, 'utf8');
  if (src.includes(MARKER)) {
    console.log(`${PREFIX} already patched: ${target}`);
    return;
  }
  if (!existsSync(PATCHED)) {
    console.error(`${PREFIX} 缺少 ${PATCHED}（包内组件权威文件），请更新包后重试`);
    process.exit(1);
  }

  const patched = readFileSync(PATCHED, 'utf8');
  const start = patched.indexOf('\t\t/**\n\t\t* dsh-wechat 本地补丁：');
  const end = patched.indexOf('\n\t\tfunction WorkspaceBrowser({ wide, expandSidebar,');
  if (start === -1 || end === -1 || start >= end) {
    console.error(`${PREFIX} patched 文件缺少补丁块，请更新包后重试`);
    process.exit(1);
  }
  const block = patched.slice(start, end);

  const anchorA = '\t\tfunction WorkspaceBrowser({ wide, expandSidebar,';
  if (countOccurrences(src, anchorA) !== 1) {
    console.error(`${PREFIX} anchor A 不唯一，bundle 版本可能已变化，请更新补丁`);
    process.exit(1);
  }
  src = src.replace(anchorA, block + '\n' + anchorA);

  const oldB = 'children: wide && (normalizedQuery !== "" ? (0, react_jsx_runtime.jsx)(SearchResults, {';
  if (countOccurrences(src, oldB) !== 1) {
    console.error(`${PREFIX} anchor B 不唯一，bundle 版本可能已变化，请更新补丁`);
    process.exit(1);
  }
  src = src.replace(oldB, 'children: [wide && (normalizedQuery !== "" ? (0, react_jsx_runtime.jsx)(SearchResults, {');

  const lit = 'setDeleteError(null);\n\t\t\t\t\t\t\t}\n\t\t\t\t\t\t}))\n\t\t\t\t\t}),';
  if (countOccurrences(src, lit) !== 1) {
    console.error(`${PREFIX} anchor C 不唯一，bundle 版本可能已变化，请更新补丁`);
    process.exit(1);
  }
  const repl = [
    'setDeleteError(null);',
    '\t\t\t\t\t\t\t}',
    '\t\t\t\t\t\t})), (0, react_jsx_runtime.jsx)(WechatFolderSection, {',
    '\t\t\t\t\t\t\tuseSessions,',
    '\t\t\t\t\t\t\topen,',
    '\t\t\t\t\t\t\twide',
    '\t\t\t\t\t\t})]',
    '\t\t\t\t\t}),',
  ].join('\n');
  src = src.replace(lit, repl);

  writeFileSync(target, src);
  console.log(`${PREFIX} patched: ${target}`);
  console.log(`${PREFIX} DSH 内置 HMR 将自动热更新；浏览器未生效请刷新页面。`);
}

main();
