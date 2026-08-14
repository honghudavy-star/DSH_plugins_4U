#!/usr/bin/env bash
# dsh-plugins 一键安装脚本
# 1) 应用 wechat-ui 补丁（自动定位 bundle，幂等，HMR 热更新）
# 2) 部署 wechat-bridge 到运行时目录并安装/刷新 launchd 服务
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UI_DIR="$REPO_DIR/wechat-ui"
BRIDGE_SRC="$REPO_DIR/wechat-bridge"
BRIDGE_RUNTIME="/Users/hungdavy/DSH/plugins/self-built/dsh-wechat"
LABEL="com.dsh.wechatbridge"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"
UID_NUM="$(id -u)"

echo "== DSH 插件一键安装 =="

# ---------- 1. 微信入口 UI 补丁 ----------
echo ""
echo "[1/2] 应用微信入口 UI 补丁…"
BUNDLE="$(ls -1dt "$HOME"/.npm/_npx/*/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js 2>/dev/null | head -1 || true)"
if [ -z "$BUNDLE" ]; then
  echo "  !! 未找到 DSH workspace bundle（DSH 未安装或 npx 缓存路径变化）"
  echo "  请手动指定路径执行: python3 \"$UI_DIR/reapply.py\" <bundle绝对路径>"
else
  echo "  目标 bundle: $BUNDLE"
  python3 "$UI_DIR/reapply.py" "$BUNDLE"
  echo "  UI 补丁完成（HMR 自动热更新；浏览器未生效请刷新页面）"
fi

# ---------- 2. 微信桥接器 ----------
echo ""
echo "[2/2] 部署微信桥接器…"
mkdir -p "$BRIDGE_RUNTIME"
# 拷贝源码（保留运行数据目录 ~/.dsh-wechat 不动）
for f in dsh-wechat-bridge.mjs notify.mjs package.json package-lock.json README.md test-dsh-side.mjs verify-wechat-loop.mjs; do
  cp "$BRIDGE_SRC/$f" "$BRIDGE_RUNTIME/" 2>/dev/null || true
done
# 首次部署时安装依赖
if [ ! -d "$BRIDGE_RUNTIME/node_modules" ]; then
  echo "  安装桥接器依赖（npm install）…"
  (cd "$BRIDGE_RUNTIME" && npm install --no-audit --no-fund >/dev/null 2>&1 || npm install --no-audit --no-fund)
fi

# 生成 plist（路径跟随运行时目录，node 用当前 PATH 里的 node）
NODE_BIN="$(command -v node || echo /Users/hungdavy/.hermes/node/bin/node)"
cat > "$PLIST_DST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$BRIDGE_RUNTIME/dsh-wechat-bridge.mjs</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$BRIDGE_RUNTIME</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$HOME/.dsh-wechat/bridge.out.log</string>
  <key>StandardErrorPath</key>
  <string>$HOME/.dsh-wechat/bridge.err.log</string>
</dict>
</plist>
EOF

if launchctl print "gui/$UID_NUM/$LABEL" >/dev/null 2>&1; then
  echo "  服务已存在，刷新配置…"
  launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
  sleep 1
  launchctl bootstrap "gui/$UID_NUM" "$PLIST_DST" 2>/dev/null || launchctl load "$PLIST_DST" 2>/dev/null || true
else
  echo "  安装 launchd 服务…"
  launchctl bootstrap "gui/$UID_NUM" "$PLIST_DST" 2>/dev/null || launchctl load "$PLIST_DST" 2>/dev/null || true
fi
sleep 2
if launchctl print "gui/$UID_NUM/$LABEL" >/dev/null 2>&1; then
  echo "  桥接器服务已运行（日志: ~/.dsh-wechat/bridge.out.log）"
  echo "  首次使用需扫码登录，见 wechat-bridge/README.md"
else
  echo "  !! 服务未启动，请检查: launchctl print gui/$UID_NUM/$LABEL"
fi

echo ""
echo "== 完成 =="
