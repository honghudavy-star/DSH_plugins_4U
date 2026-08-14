#!/usr/bin/env node
// install.mjs — 部署「识图」功能包（@dsh-plugins/vision）
// 幂等：① 部署 luma-mcp 到运行时目录并装依赖 ② 重放运行时补丁（含 npx 缓存里的适配器/受理门补丁）
//       ③ 写 cordis.patch.yml（mcp-vision + persona 识图指令，API Key 不入库）
//
// 环境变量:
//   DSH_PLUGINS_RUNTIME_DIR  运行时根目录（默认 $HOME/DSH/plugins/third-party）
//   SILICONFLOW_API_KEY      首次配置时提供 API Key（否则交互输入）
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PREFIX = '[dsh-plugins/vision]';

function lumaRuntimeDir() {
  if (process.env.DSH_VISION_LUMA_DIR) return process.env.DSH_VISION_LUMA_DIR;
  const home = homedir();
  const preferred = join(home, 'DSH', 'plugins', 'third-party', 'luma-mcp', 'package');
  if (home === '/Users/hungdavy' || existsSync(join(home, 'DSH'))) return preferred;
  return join(home, 'Library', 'Application Support', 'dsh-plugins', 'luma-mcp');
}

function main() {
  const dest = lumaRuntimeDir();
  mkdirSync(dest, { recursive: true });

  // 1. 部署 luma-mcp（含本地补丁的 build，递归拷贝）
  console.log(`${PREFIX} 部署 luma-mcp → ${dest}`);
  mkdirSync(dest, { recursive: true });
  cpSync(join(HERE, 'luma-mcp'), dest, { recursive: true, force: true });

  // 2. 依赖（sharp 为原生模块，首次安装较慢）
  if (!existsSync(join(dest, 'node_modules'))) {
    console.log(`${PREFIX} 安装 luma-mcp 依赖（npm install，含原生模块 sharp，可能需要一两分钟）…`);
    execSync('npm install --no-audit --no-fund', { cwd: dest, stdio: 'inherit' });
  } else {
    console.log(`${PREFIX} 依赖已存在`);
  }

  // 3. 重放运行时补丁（luma 白名单/魔数嗅探 + npx 缓存里的适配器/受理门补丁）
  console.log(`${PREFIX} 重放运行时补丁…`);
  execSync(`${process.execPath} "${join(HERE, 'apply-patches.mjs')}"`, {
    stdio: 'inherit',
    env: { ...process.env, DSH_VISION_LUMA_DIR: dest },
  });

  // 4. 写 profile 配置（mcp-vision + persona 识图指令）
  console.log(`${PREFIX} 写入 DSH profile 配置…`);
  execSync(`${process.execPath} "${join(HERE, 'patch-profile.mjs')}"`, {
    stdio: 'inherit',
    env: { ...process.env, DSH_VISION_LUMA_DIR: dest },
  });

  console.log('');
  console.log(`${PREFIX} 完成。`);
  console.log(`${PREFIX} 重要：npx 缓存补丁与配置修改需要【重启 DSH】才生效：`);
  console.log(`${PREFIX}   停掉当前 dsh web（终端 Ctrl+C），重新运行: npm exec @deepseek-ai/dsh web`);
  console.log(`${PREFIX}   重启后：在 GUI 直接粘贴/拖拽图片，agent 会自动识图回答。`);
}

main();
