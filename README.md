# dsh-plugins — DSH 自建插件集合（一键安装）

DSH（DeepSeek Harness）自建插件的**源仓库 + 一键安装**。解决 DSH 重装/升级后
npx 缓存被还原、自建改动丢失的问题：所有插件在这里保存，用 `install.sh` 一键重新部署。

> 私有仓库。**严禁提交任何凭据/密钥**（微信凭据在 `~/.dsh-wechat/`，API Key 在
> `~/.dsh/profiles/web/cordis.patch.yml`，均不在本仓库内）。

## 插件清单

| 目录 | 作用 | 安装方式 |
|------|------|----------|
| `wechat-bridge/` | 微信(官方 iLink) ⇄ DSH 桥接器 v3：消息互转、图片/文件、断线自动重连与回复补发、主动发送 HTTP 接口 | launchd 服务（`install.sh` 自动装） |
| `wechat-ui/` | DSH Web GUI 首页「微信」入口补丁（微信 logo 图标，单会话直显「微信对话」，多会话折叠，无会话隐藏） | 补丁 + HMR 热更新（`install.sh` 自动打） |

## 一键安装

```bash
git clone git@github.com:honghudavy-star/dsh-plugins.git   # 或 HTTPS
cd dsh-plugins
./install.sh
```

`install.sh` 做两件事：

1. **UI 补丁**：自动定位 DSH 客户端 bundle（`~/.npm/_npx/*/node_modules/@deepseek-ai/dsh-client-ui-workspace/...`）
   并执行 `wechat-ui/reapply.py`（幂等）。改动后 DSH 内置 HMR 500ms 内自动热更新，
   无需重启服务；浏览器没反应就刷新一次。
2. **桥接器 launchd 服务**：把 `wechat-bridge` 部署到
   `/Users/hungdavy/DSH/plugins/self-built/dsh-wechat/`，安装/刷新
   `~/Library/LaunchAgents/com.dsh.wechatbridge.plist`，`launchctl bootstrap` 拉起。
   首次运行需手机微信扫码登录（见 `wechat-bridge/README.md`）。

## 为什么 UI 是"补丁"而不是"插件"

首页会话列表（`dsh-client-ui-workspace`）目前**没有对外暴露可注入的自定义分区插槽**，
客户端插件系统（`dsh.client` + slots）只能注入已声明的槽位（如输入栏工具区、侧边栏脚部
按钮），无法在消息列表底部加分区。因此采用「直接补丁 bundle + 一键重打」的方式：
补丁文件保存在本仓库，DSH 升级后被还原时重跑 `install.sh` 即可恢复。
若未来 DSH 新增相关槽位，可迁移为真正的客户端插件。

## 依赖与运行时位置

- 运行时安装目标：`/Users/hungdavy/DSH/plugins/self-built/`（见全局 AGENTS.md 约定）
- 微信桥接器运行数据：`~/.dsh-wechat/`（凭据、同步游标、转发水位、媒体文件）——不属于仓库
- DSH 本体：npx 缓存（升级会还原，本仓库即为此而生）

## 更新流程

改好插件后：

```bash
cp <runtime>/dsh-wechat-bridge.mjs wechat-bridge/          # 示例
cp <runtime>/client.js.patched wechat-ui/dsh-client-ui-workspace.client.js.patched
git add -A && git commit -m "..." && git push
```

> 改 UI 组件时：先改 `wechat-ui/dsh-client-ui-workspace.client.js.patched`（组件权威来源），
> 再重新拷贝到运行时 bundle 生效；`reapply.py` 会自动从 patched 文件提取组件块。
