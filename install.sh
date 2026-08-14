#!/usr/bin/env bash
# DSH_plugins_4U 一键安装
# 每个功能封装为独立 npm 包；npm pack 打包后全局安装，
# 安装时自动执行包的 install 脚本完成部署（幂等）。
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "== DSH_plugins_4U 一键安装 =="

for pkg in wechat-ui wechat-bridge; do
  echo ""
  echo ">> @dsh-plugins/$pkg"
  (cd "$REPO_DIR/packages/$pkg" && npm pack --pack-destination "$TMP" >/dev/null)
  TGZ="$(ls -1 "$TMP"/dsh-plugins-"$pkg"-*.tgz | head -1)"
  npm install --global --foreground-scripts --no-audit --no-fund "$TGZ"
  rm -f "$TMP"/*.tgz
done

echo ""
echo "== 完成 =="
echo "UI 补丁由 DSH 内置 HMR 自动生效；浏览器未变化时刷新页面即可。"
echo "桥接器日志: ~/.dsh-wechat/bridge.out.log"
