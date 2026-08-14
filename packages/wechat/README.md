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

前提：电脑上已装好 DSH，能打开 http://127.0.0.1:3080

```bash
cd /Users/hungdavy/DSH_plugins_4U
./install.sh          # 一键装全部；或只装这一个：
npm pack ./packages/wechat && npm install --global --foreground-scripts dsh-plugins-wechat-*.tgz
```

## 第一次用（只有一次）

1. 安装完成后，看日志等一个二维码：`tail -f ~/.dsh-wechat/bridge.out.log`
2. 用**手机微信**「扫一扫」登录（一次性）
3. 在微信里给 DSH 发条消息试试，应该马上收到回复

## 出问题了怎么办

- 看日志：`tail -50 ~/.dsh-wechat/bridge.out.log`
- 微信一直没回复：等几秒（断线自动重连中），或重启服务
  `launchctl kickstart -k gui/$(id -u)/com.dsh.wechatbridge`
- 想彻底重来（重新扫码）：删除 `~/.dsh-wechat/credentials.json` 再重启服务

## 技术细节（给维护者）

源码在 `src/`，运行数据在 `~/.dsh-wechat/`（凭据、同步游标、转发水位、媒体文件）。
详细说明见 `src/README.md`。
