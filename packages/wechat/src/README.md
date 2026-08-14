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

前置：Node.js 22 或更高版本，且 DSH Web GUI 在运行（`dsh web`，默认 http://127.0.0.1:3080）。

```bash
cd ~/DSH/plugins/self-built/dsh-wechat   # 本项目目录（2026-08 起迁至 DSH 专用目录）
node dsh-wechat-bridge.mjs
```

首次运行：
1. 终端显示二维码 → **手机微信「扫一扫」** → 手机上确认登录
2. 凭据和扫码结果中的 `userId` 保存到 `~/.dsh-wechat/credentials.json`，该账号自动成为唯一 owner，之后自动恢复登录
3. 桥接器自动创建/复用 DSH「微信」会话。其他联系人会在下载媒体、保存 token 或调用 DSH 前被拒绝

之后：
- 微信私信发给 iLink bot → 消息出现在 DSH GUI「微信」会话 → agent 处理 → 回复自动发回微信
- DSH GUI 里同一个会话也可以继续对话；GUI 输入不会被当成微信入站，也不会触发自动外发

## 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `DSH_BASE` | DSH HTTP 地址 | `http://127.0.0.1:3080` |
| `WECHAT_SESSION_ID` | 指定 DSH 会话 id（不指定则持久化复用） | 自动 |
| `WECHAT_CRED_DIR` | 凭据目录 | `~/.dsh-wechat` |
| `WECHAT_OWNER` | 旧凭据没有 `userId` 时用于一次性迁移的 owner 用户 id | 无 |
| `WECHAT_BRIDGE_PORT` | 本地通知接口端口 | `8790` |
| `WECHAT_BRIDGE_TOKEN` | 显式本地接口 token；未配置时自动生成 | 自动 |
| `WECHAT_BRIDGE_TOKEN_FILE` | token 私有文件 | `~/.dsh-wechat/bridge-token` |
| `DSH_CWD` | 新建会话工作目录 | 当前目录 |

`POST /send` 和 `GET /health` 都强制校验 Bearer token；`body.to` 只能省略或等于唯一 owner。`notify.mjs` 默认读取 token 文件。发送文件只接受存在的绝对路径和普通文件：

```bash
node notify.mjs --text "报告好了" --file /absolute/path/report.pdf
```

安全边界：`WECHAT_BRIDGE_TOKEN_FILE` 若显式设置，canonical 路径也必须恰好是凭据目录下的 `bridge-token`。自定义 `WECHAT_CRED_DIR` 必须是空/新目录，或带有安装器创建的 dsh-wechat 状态标记；目录出现未知顶层文件时会拒绝启动，避免误把 HOME/文档目录递归改权。

## 持续化（launchd 常驻服务）

包安装器会先执行选定的 `DSH_PLUGINS_NODE --version`，只有可执行的 Node.js 22+ 才生成 macOS launchd 服务。升级会在私有 staging 目录按 `package-lock.json` 执行 `npm ci`，准备和 launchd 激活任一步失败都会恢复旧运行时、token、owner 与 plist：
**开机自启、崩溃自动重启、只绑定一次**（凭据自动恢复，不再扫码）。

```bash
# 安装或升级服务（在仓库根目录执行）
./install.sh wechat

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

- **媒体**：图片可注入 DSH，其他媒体保存到私有凭据目录；外发文件必须是存在的绝对路径和普通文件。
- **授权**：新扫码直接绑定登录结果中的 `userId`；恢复登录只接受凭据中的 `userId` 或显式 `WECHAT_OWNER`。旧 `owner.json` 可能来自早期“首个来信者绑定”，现在只作为镜像、不参与信任；两项可信来源都没有时失败关闭。
- **回复关联**：每条已授权微信消息都带一个私有状态中登记、绑定会话与事件序号、一次性消费的 bridge-origin correlation。只有该回合的最终回复会发回 owner；伪造可见的 owner 文本前缀不会触发外发。
- **断线补发**：历史会持续向前分页，直到覆盖持久化转发水位或服务明确没有更早事件；未取完整批次时不会处理事件或推进水位。
- **安装目标**：自定义运行目录只能是空/新目录或可验证的 `dsh-wechat` 运行时；HOME、源码目录、凭据/plist 路径及普通非插件目录都会在 staging 和改权前拒绝。
- **iLink bot 身份限制**（官方特性，所有 iLink 方案相同）：只有私信（DM）可靠；普通微信群消息大多不会推送。
- **个人号自动化风险**：iLink 是官方开放接口，但腾讯可能收紧政策，建议小号低频使用。
- 会话过期（`sessionExpired`）时按提示删除 `~/.dsh-wechat/credentials.json` 重新扫码。

## 文件

- `dsh-wechat-bridge.mjs` — 桥接器主程序
- `bridge-origin.mjs` — 一次性入站 correlation 的持久化与校验
- `bridge-forwarding.mjs` — 回复发送与持久化水位提交
- `test-dsh-side.mjs` — DSH 侧链路测试（`node test-dsh-side.mjs`）
