# 微信快捷入口（@dsh-plugins/wechat）

> 在 DSH 首页加一个绿色微信按钮，一键打开微信对话。

## 这是什么？

装好「微信聊天」后，你的 DSH 首页（会话列表）底部会多一个**绿色微信图标入口**：

- ✅ 点一下，直接进入微信对话（和电脑上聊天的消息分开，一眼分清）
- ✅ 只有一个微信对话时：直接显示一行「微信对话」，不用展开收起
- ✅ 有多个微信对话时：显示「微信」文件夹，点开能看到全部
- ✅ 没有微信对话时：自动隐藏，不占地方

## 怎么安装

```bash
cd /Users/hungdavy/DSH_plugins_4U
./install.sh          # 一键装全部；或只装这一个：
npm pack ./packages/wechat-shortcut && npm install --global --foreground-scripts dsh-plugins-wechat-*.tgz
```

装完**不用重启**：DSH 会自动热更新，几秒内首页就能看到绿色微信入口
（没出现就刷新一下浏览器页面）。

> 建议先装「微信聊天」包，否则没有微信对话可进，入口会自动隐藏。

## 出问题了怎么办

- 首页没看到入口：确认「微信聊天」已装好、刷新页面
- DSH 升级后入口消失：重跑一遍安装即可（升级会还原界面补丁，这是正常现象）

## 技术细节（给维护者）

组件代码的权威来源是 `dsh-client-ui-workspace.client.js.patched`；
`reapply.mjs` 从该文件提取补丁块，自动定位 DSH 客户端 bundle 打补丁（幂等）。
DSH 内置 HMR（500ms 轮询）自动热更新，无需重启服务。
