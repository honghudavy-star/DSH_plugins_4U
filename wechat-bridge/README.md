# dsh-wechat — 微信(官方 iLink) ⇄ DSH 桥接器

在**个人微信**上和 DSH 对话、安排任务，对话**原生显示在 DSH Web GUI** 的「微信」会话里。

## 原理

```
手机微信
  ⇄ 官方 iLink Bot API（wechat-ilink-client：从腾讯官方 openclaw-weixin 提取，扫码登录、长轮询）
  ⇄ 本桥接器（dsh-wechat-bridge.mjs，薄胶水）
  ⇄ DSH 自带 HTTP/WS API（与 Web GUI 同一条链路）：
      POST /api/session.prompt → 微信消息注入「微信」会话（GUI 原生显示）
      WS   /api/events.mux    → agent 回复 → sendText 发回微信
```

- 微信侧：**腾讯官方 iLink 协议**（2026-03 官方开放，`ilinkai.weixin.qq.com`），扫码登录，无需微信桌面端常驻，无需辅助功能权限。
- DSH 侧：**DSH 自身的会话机制**——消息就是普通会话消息，GUI 实时显示，agent 照常执行任务。
- 实时性：长轮询推送，微信消息到达即处理（无轮询延迟）。

## 已验证

- [x] iLink 客户端登录/二维码（实测拿到二维码 URL 并渲染）
- [x] DSH 侧链路端到端：创建会话 → 注入消息 → agent 回复经 mux 收到（实测回复"链路正常"）
- [x] 兼容当前 DSH：`@deepseek-ai/dsh@0.1.0-rc.6`（API 层验证）

## 使用

前置：DSH Web GUI 在运行（`dsh web`，默认 http://127.0.0.1:3080）。

```bash
cd ~/DSH/plugins/self-built/dsh-wechat   # 本项目目录（2026-08 起迁至 DSH 专用目录）
node dsh-wechat-bridge.mjs
```

首次运行：
1. 终端显示二维码 → **手机微信「扫一扫」** → 手机上确认登录
2. 凭据保存到 `~/.dsh-wechat/credentials.json`，之后自动恢复登录
3. 桥接器自动创建/复用 DSH「微信」会话

之后：
- 微信私信发给 iLink bot → 消息出现在 DSH GUI「微信」会话 → agent 处理 → 回复自动发回微信
- DSH GUI 里同一个会话也可以继续对话

## 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `DSH_BASE` | DSH HTTP 地址 | `http://127.0.0.1:3080` |
| `WECHAT_SESSION_ID` | 指定 DSH 会话 id（不指定则持久化复用） | 自动 |
| `WECHAT_CRED_DIR` | 凭据目录 | `~/.dsh-wechat` |
| `DSH_CWD` | 新建会话工作目录 | 当前目录 |

## 持续化（launchd 常驻服务）

已配置为 macOS launchd 服务：**开机自启、崩溃自动重启、只绑定一次**（凭据自动恢复，不再扫码）。

```bash
# 安装服务（已执行）
cp com.dsh.wechatbridge.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.dsh.wechatbridge.plist

# 日常管理
launchctl print gui/$(id -u)/com.dsh.wechatbridge   # 查看状态
tail -f ~/.dsh-wechat/bridge.out.log               # 查看日志
launchctl bootout gui/$(id -u)/com.dsh.wechatbridge # 停止服务
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.dsh.wechatbridge.plist  # 启动服务

# 换绑微信号（重新扫码）
rm ~/.dsh-wechat/credentials.json && launchctl kickstart -k gui/$(id -u)/com.dsh.wechatbridge
```

桥接器在 DSH 未启动时会自动重试连接，DSH 后启动即可自动接上。

## 说明与限制

- **v1 仅文本**：收发文本消息；图片/文件/语音的收发（库已支持 `sendMedia`）留待扩展。
- **回复关联**：一条微信消息 → 一轮回复（agent 的最终文本回复发回发送者）。同一会话里 GUI 手动对话与微信对话交错时以最近一次注入为准。
- **iLink bot 身份限制**（官方特性，所有 iLink 方案相同）：只有私信（DM）可靠；普通微信群消息大多不会推送。
- **个人号自动化风险**：iLink 是官方开放接口，但腾讯可能收紧政策，建议小号低频使用。
- 会话过期（`sessionExpired`）时按提示删除 `~/.dsh-wechat/credentials.json` 重新扫码。

## 文件

- `dsh-wechat-bridge.mjs` — 桥接器主程序
- `test-dsh-side.mjs` — DSH 侧链路测试（`node test-dsh-side.mjs`）
