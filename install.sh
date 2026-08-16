#!/usr/bin/env bash
# 将本仓库的功能包按 DSH stable 原生 bundle 格式安装到指定 profile。
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACK_DIR="$(mktemp -d)"
DSH_VERSION="${DSH_VERSION:-0.1.0-rc.6}"
DSH_PROFILE="${DSH_PROFILE:-web}"
DSH_HOME_DIR="${DSH_HOME:-${HOME}/.dsh}"
ARCHIVE_DIR="${DSH_PLUGIN_ARCHIVE_DIR:-$DSH_HOME_DIR/plugin-packages}"
trap 'rm -rf "$PACK_DIR"' EXIT
cd "$REPO_DIR"

if [ "$#" -eq 0 ]; then
  REQUESTED=(wechat wallpaper vision)
else
  REQUESTED=("$@")
fi

# 总插件始终安装：它负责注册“设置 → 插件 → 自定义插件”页面。
PKGS=(4u)
for pkg in "${REQUESTED[@]}"; do
  case "$pkg" in
    4u|wechat|wallpaper|vision) ;;
    *) echo "未知插件: $pkg（可用: 4u wechat wallpaper vision）" >&2; exit 2 ;;
  esac
  if [ "$pkg" != "4u" ]; then PKGS+=("$pkg"); fi
done

echo "== DSH Plugins 4U =="
echo "DSH: @deepseek-ai/dsh@$DSH_VERSION"
echo "Profile: $DSH_PROFILE"
echo "Packages: $ARCHIVE_DIR"
mkdir -p "$ARCHIVE_DIR"

for pkg in "${PKGS[@]}"; do
  echo
  echo ">> 打包并安装 @dsh-plugins/$pkg"
  if [ "$pkg" = "4u" ]; then
    npm pack --pack-destination "$PACK_DIR" >/dev/null
  else
    npm pack --workspace "@dsh-plugins/$pkg" --pack-destination "$PACK_DIR" >/dev/null
  fi
  tgz="$(find "$PACK_DIR" -maxdepth 1 -type f -name "dsh-plugins-$pkg-*.tgz" -print -quit)"
  if [ -z "$tgz" ]; then
    echo "没有生成 @dsh-plugins/$pkg 的 tarball" >&2
    exit 1
  fi
  archive="$ARCHIVE_DIR/$(basename "$tgz")"
  cp "$tgz" "$archive"
  npm exec --yes --package="@deepseek-ai/dsh@$DSH_VERSION" -- \
    dsh plugin --profile "$DSH_PROFILE" add "$archive"
done

echo
echo "安装完成。重启 DSH Web 后生效："
echo "  npm exec --yes --package=@deepseek-ai/dsh@$DSH_VERSION -- dsh web"
echo
echo "识图插件默认从 DSH credential SILICONFLOW_API_KEY 或同名环境变量读取密钥。"
echo "微信首次启动会在 DSH 终端输出二维码；运行数据保存在 ~/.dsh-wechat/。"
