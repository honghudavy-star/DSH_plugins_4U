#!/usr/bin/env bash
# DSH_plugins_4U 一键安装
# 每个功能一个独立 npm 包，安装时自动完成部署（幂等）：
#   1) wechat    微信         —— 手机微信 ⇄ 电脑 DSH 聊天 + 首页绿色微信入口
#   2) wallpaper 更换背景壁纸  —— 一键换壁纸（内置预设/自选图片）
#   3) vision    识图         —— 粘贴图片自动识别/描述/OCR
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$INSTALL_TMP_DIR"' EXIT

echo "== DSH_plugins_4U 一键安装 =="

# 要安装的功能包（默认全装；可只装指定：./install.sh wechat）
if [ "$#" -eq 0 ]; then
  PKGS=(wechat wallpaper vision)
else
  PKGS=("$@")
fi

# 先完整校验参数，避免安装一部分后才因拼写错误停下。
for pkg in "${PKGS[@]}"; do
  case "$pkg" in
    wechat|wallpaper|vision) ;;
    *)
      printf '!! 未知功能包: %s（当前可用: wechat wallpaper vision）\n' "${pkg}" >&2
      exit 1
      ;;
  esac
done

INSTALLED_PKGS=()
for pkg in "${PKGS[@]}"; do
  echo ""
  case "$pkg" in
    wechat)    NAME="微信" ;;
    wallpaper) NAME="更换背景壁纸" ;;
    vision)    NAME="识图" ;;
  esac
  echo ">> [${NAME}] @dsh-plugins/${pkg}"
  if [ ! -d "$REPO_DIR/packages/${pkg}" ]; then
    printf '  !! 包目录不存在: packages/%s\n' "${pkg}" >&2
    exit 1
  fi
  PACK_DIR="$(mktemp -d "${INSTALL_TMP_DIR}/${pkg}.XXXXXX")"
  (cd "$REPO_DIR/packages/${pkg}" && npm pack --pack-destination "$PACK_DIR" >/dev/null)
  TGZS=("${PACK_DIR}"/*.tgz)
  if [ "${#TGZS[@]}" -ne 1 ] || [ ! -f "${TGZS[0]}" ]; then
    printf '  !! 打包结果异常：packages/%s 应只生成一个 tarball\n' "${pkg}" >&2
    exit 1
  fi
  TGZ="${TGZS[0]}"
  npm install --global --foreground-scripts --no-audit --no-fund -- "$TGZ"
  INSTALLED_PKGS+=("$pkg")
done

echo ""
printf '== 完成：已安装 %d 个功能包 ==\n' "${#INSTALLED_PKGS[@]}"
for pkg in "${INSTALLED_PKGS[@]}"; do
  case "$pkg" in
    wechat)
      echo "微信：安装流程已完成；首次使用请扫码登录（见 packages/wechat/README.md）。"
      ;;
    wallpaper)
      echo "更换背景壁纸：命令已安装，可用 dsh-plugins-wallpaper set/list/off 调整。"
      ;;
    vision)
      echo "识图：安装流程已完成；重启 DSH 后生效。"
      ;;
  esac
done
