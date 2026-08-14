#!/usr/bin/env bash
# DSH_plugins_4U 一键安装
# 每个功能一个独立 npm 包，安装时自动完成部署（幂等）：
#   1) 微信   @dsh-plugins/wechat —— 手机微信 ⇄ 电脑 DSH 聊天 + 首页绿色微信入口
#   （后续功能：更换背景壁纸、识图 —— 敬请期待）
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "== DSH_plugins_4U 一键安装 =="

# 按需安装的功能包（默认全装；可只装指定：./install.sh wechat）
PKGS=("${@:-wechat}")

for pkg in "${PKGS[@]}"; do
  echo ""
  case "$pkg" in
    wechat) NAME="微信" ;;
    *) echo "!! 未知功能包: $pkg（当前可用: wechat）"; continue ;;
  esac
  echo ">> [$NAME] @dsh-plugins/$pkg"
  if [ ! -d "$REPO_DIR/packages/$pkg" ]; then
    echo "  !! 包目录不存在: packages/$pkg"
    continue
  fi
  (cd "$REPO_DIR/packages/$pkg" && npm pack --pack-destination "$TMP" >/dev/null)
  TGZ="$(ls -1 "$TMP"/dsh-plugins-"$pkg"-*.tgz | head -1)"
  npm install --global --foreground-scripts --no-audit --no-fund "$TGZ"
  rm -f "$TMP"/*.tgz
done

echo ""
echo "== 完成 =="
echo "微信：聊天服务已在后台运行（首次使用请扫码登录，见 packages/wechat/README.md）；"
echo "       首页会自动出现绿色微信按钮（没出现就刷新浏览器）。"
