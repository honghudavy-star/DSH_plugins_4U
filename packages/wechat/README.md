# 微信（@dsh-plugins/wechat）

> 一个包搞定微信相关的一切：手机微信和电脑 DSH 聊天 + 首页绿色微信快捷入口。

## 这是什么？

装好之后：
- 你在**手机微信**里给 DSH 发消息，DSH 会回答，回复自动发回你的微信。
- 电脑上打开 DSH 也能看到这段对话，两边是通的。
- DSH 首页（会话列表）底部会多一个**绿色微信按钮**，点一下直接进入微信对话，和电脑上聊天的消息分开。

### 你能得到什么

| 功能 | 说明 |
|------|------|
| 🗨️ 微信发消息 | 手机上发消息 → 电脑 DSH 收到并自动回答 |
| 📨 回复回微信 | DSH 的回答 → 自动发到你的微信 |
| 🖼️ 图片 / 📄 文件 | 微信发图/发文件电脑能看；DSH 也能把文件发回微信 |
| 🔔 主动通知 | 脚本/定时任务随时给微信发消息（提醒、日报等） |
| 🔁 断线自动恢复 | DSH 重启、网络抖动都不怕——自动重连，**漏掉的回复会自动补发** |
| 🟢 首页快捷入口 | DSH 首页绿色微信按钮：单对话直显「微信对话」，多对话折叠，无对话自动隐藏 |

## 怎么安装

前提：电脑上已装好 DSH，能打开 http://127.0.0.1:3080，并使用 Node.js 22 或更高版本。

```bash
cd DSH_plugins_4U
./install.sh          # 一键装全部；或只装这一个：
npm pack ./packages/wechat && npm install --global --foreground-scripts dsh-plugins-wechat-*.tgz
```

## 第一次用（只有一次）

1. 安装完成后，看日志等一个二维码：`tail -f ~/.dsh-wechat/bridge.out.log`
2. 用**手机微信**「扫一扫」登录（一次性）
3. 扫码结果里的微信 `userId` 会自动保存为唯一 owner。之后只有该账号的消息能进入 DSH，其他联系人会被拒绝
4. 用这个微信账号发条普通消息试试，应该马上收到回复

旧版凭据若没有保存 `userId`，可在升级时显式提供一次 owner 完成迁移：

```bash
WECHAT_OWNER='owner-user-id' node packages/wechat/install.mjs
```

旧 `owner.json` 可能来自早期“首个来信者绑定”逻辑，因此只作为新状态镜像，**不参与启动信任**。旧凭据没有 `userId` 且未显式设置 `WECHAT_OWNER` 时，服务会失败关闭并要求重新扫码；不会信任第一个来信者。

主动通知接口始终要求本机 Bearer token。安装器会把随机 token 保存到
`~/.dsh-wechat/bridge-token`（权限 `0600`）；`notify.mjs` 会自动读取：

```bash
node ~/DSH/plugins/self-built/dsh-wechat/notify.mjs --text "该喝水了"
node ~/DSH/plugins/self-built/dsh-wechat/notify.mjs --text "报告好了" --file /absolute/path/report.pdf
```

文件必须是存在的绝对路径且为普通文件；授权 owner 可发送任意目录中的合法文件。

安装/升级会验证 launchd 实际使用的 Node 可执行文件为 22+，并在 staging 目录按 lockfile 完成依赖后再原子换入。若依赖、私有状态、plist 或 launchd 激活失败，会恢复旧运行时和配置。自定义运行目录不能指向 HOME、源码或普通文档目录；自定义凭据目录须为空/新建或由本插件标记，token 文件固定为该目录下的 `bridge-token`。

## 出问题了怎么办

- 看日志：`tail -50 ~/.dsh-wechat/bridge.out.log`
- 微信一直没回复：等几秒（断线自动重连中），或重启服务
  `launchctl kickstart -k gui/$(id -u)/com.dsh.wechatbridge`
- 想彻底重来（重新扫码）：删除 `~/.dsh-wechat/credentials.json` 再重启服务
- 想重新绑定 owner：删除 `~/.dsh-wechat/credentials.json` 和 `~/.dsh-wechat/owner.json`，再重启并重新扫码

## 技术细节（给维护者）

源码在 `src/`，运行数据在 `~/.dsh-wechat/`（凭据、HTTP token、授权配置、同步游标、转发水位、媒体文件）。目录权限为 `0700`，其中普通文件为 `0600`。
详细说明见 `src/README.md`。
