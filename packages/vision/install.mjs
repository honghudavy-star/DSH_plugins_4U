#!/usr/bin/env node
// install.mjs — 部署「识图」功能包（@dsh-plugins/vision）
// 幂等：① 部署 luma-mcp 到运行时目录并装依赖 ② 重放运行时补丁（含 npx 缓存里的适配器/受理门补丁）
//       ③ 写 cordis.patch.yml（mcp-vision + persona 识图指令，API Key 不入库）
//
// 环境变量:
//   DSH_PLUGINS_RUNTIME_DIR  运行时根目录（默认 $HOME/DSH/plugins/third-party）
//   DSH_VISION_LUMA_DIR      luma-mcp 最终目录（优先级高于上面的运行时根目录）
//   DSH_NPX_RUNTIME_DIR      当前 DSH npm-exec 运行时（多缓存时必须显式设置）
//   DSH_PROFILE_FILE         DSH profile 文件路径
//   SILICONFLOW_API_KEY      首次配置时提供 API Key（否则交互输入）
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deployLumaRuntime } from './lib/install-runtime.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PREFIX = '[dsh-plugins/vision]';

function lumaRuntimeDir() {
  if (process.env.DSH_VISION_LUMA_DIR) return process.env.DSH_VISION_LUMA_DIR;
  if (process.env.DSH_PLUGINS_RUNTIME_DIR) {
    return join(process.env.DSH_PLUGINS_RUNTIME_DIR, 'luma-mcp', 'package');
  }
  const home = homedir();
  const preferred = join(home, 'DSH', 'plugins', 'third-party', 'luma-mcp', 'package');
  if (existsSync(join(home, 'DSH'))) return preferred;
  return join(home, 'Library', 'Application Support', 'dsh-plugins', 'luma-mcp');
}

function main() {
  const requestedDest = lumaRuntimeDir();

  // 1. 在同级临时目录完整部署后原子替换，安装失败保留上一个可用版本。
  console.log(`${PREFIX} 部署 luma-mcp → ${requestedDest}`);
  console.log(`${PREFIX} 按 package-lock.json 刷新依赖（npm ci，含原生模块 sharp）…`);
  const dest = deployLumaRuntime(join(HERE, 'luma-mcp'), requestedDest);

  // 3. 重放运行时补丁（luma 白名单/魔数嗅探 + npx 缓存里的适配器/受理门补丁）
  console.log(`${PREFIX} 重放运行时补丁…`);
  execFileSync(process.execPath, [join(HERE, 'apply-patches.mjs')], {
    stdio: 'inherit',
    env: { ...process.env, DSH_VISION_LUMA_DIR: dest },
  });

  // 4. 写 profile 配置（mcp-vision + persona 识图指令）
  console.log(`${PREFIX} 写入 DSH profile 配置…`);
  execFileSync(process.execPath, [join(HERE, 'patch-profile.mjs')], {
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
