#!/usr/bin/env node
// install.mjs — 部署「微信」功能包（@dsh-plugins/wechat）
// 幂等：① 部署聊天服务（拷贝源码→装依赖→生成 plist→启动 launchd）② 打首页微信入口 UI 补丁。
//
// 环境变量:
//   DSH_PLUGINS_RUNTIME_DIR  运行时安装目录（默认 $HOME/DSH/plugins/self-built/dsh-wechat）
//   DSH_PLUGINS_NODE         launchd 使用的 node 可执行文件（默认当前 node）
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'src');
const LABEL = 'com.dsh.wechatbridge';
const PREFIX = '[dsh-plugins/wechat]';

function runtimeDir() {
  if (process.env.DSH_PLUGINS_RUNTIME_DIR) return process.env.DSH_PLUGINS_RUNTIME_DIR;
  const home = homedir();
  const preferred = join(home, 'DSH', 'plugins', 'self-built', 'dsh-wechat');
  // 本机约定（/Users/hungdavy/DSH）；其他机器回退到 Application Support
  if (home === '/Users/hungdavy' || existsSync(join(home, 'DSH'))) return preferred;
  return join(home, 'Library', 'Application Support', 'dsh-plugins', 'dsh-wechat');
}

function main() {
  if (platform() !== 'darwin') {
    console.error(`${PREFIX} 目前仅支持 macOS（launchd 服务）`);
    process.exit(0);
  }
  const dest = runtimeDir();
  mkdirSync(dest, { recursive: true });

  // 1. 拷贝源码
  for (const f of readdirSync(SRC)) {
    copyFileSync(join(SRC, f), join(dest, f));
  }
  console.log(`${PREFIX} 源码已部署: ${dest}`);

  // 2. 依赖（首次）
  if (!existsSync(join(dest, 'node_modules'))) {
    console.log(`${PREFIX} 安装运行依赖（npm install）…`);
    execSync('npm install --no-audit --no-fund', { cwd: dest, stdio: 'inherit' });
  }

  // 3. 生成 launchd plist（路径跟随运行时目录）
  const nodeBin = process.env.DSH_PLUGINS_NODE || process.execPath;
  const logDir = join(homedir(), '.dsh-wechat');
  mkdirSync(logDir, { recursive: true });
  const plistDst = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
  mkdirSync(dirname(plistDst), { recursive: true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${dest}/dsh-wechat-bridge.mjs</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${dest}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${logDir}/bridge.out.log</string>
  <key>StandardErrorPath</key>
  <string>${logDir}/bridge.err.log</string>
</dict>
</plist>
`;
  writeFileSync(plistDst, plist);
  console.log(`${PREFIX} plist 已生成: ${plistDst}`);

  // 4. launchctl 启动/刷新（幂等：已在运行则跳过）
  const uid = process.getuid();
  const running = (() => {
    try {
      execSync(`launchctl print gui/${uid}/${LABEL}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();
  if (running) {
    console.log(`${PREFIX} 聊天服务已在运行，跳过（如需重启: launchctl kickstart -k gui/${uid}/${LABEL}）`);
  } else {
    try {
      execSync(`launchctl bootstrap gui/${uid} "${plistDst}"`, { stdio: 'inherit' });
    } catch {
      execSync(`launchctl load "${plistDst}"`, { stdio: 'inherit' });
    }
    console.log(`${PREFIX} 聊天服务已启动: ${LABEL}`);
    console.log(`${PREFIX} 首次使用需手机微信扫码登录，见 src/README.md（日志: ${logDir}/bridge.out.log）`);
  }

  // 5. 首页微信快捷入口（UI 补丁，HMR 自动热更新）
  console.log(`${PREFIX} 应用首页微信快捷入口补丁…`);
  try {
    execSync(`${process.execPath} "${join(HERE, 'ui', 'reapply.mjs')}"`, { stdio: 'inherit' });
  } catch (e) {
    console.error(`${PREFIX} UI 补丁执行失败: ${e.message}`);
  }
}

main();
