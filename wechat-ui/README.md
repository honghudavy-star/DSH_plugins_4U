# dsh-wechat-ui — DSH Web GUI 微信入口（本地补丁）

在 DSH Web GUI 首页（会话列表侧边栏）**消息列表底部**新增「微信」入口：

- 微信官方绿色 logo 图标
- **只有一个微信会话**时：直接显示一行「微信对话」，点击进入会话，**无展开/收起**
- **多个微信会话**时：显示「微信」折叠分区，展开后列出每个会话
- 没有微信会话时：分区隐藏
- 会话识别：优先用桥接器持久化的会话 id（`~/.dsh-wechat/session.json`），兜底精确匹配标题「微信」
  （**不做前缀匹配**，避免误收标题含「微信」的普通 GUI 会话）

## 文件

- `dsh-client-ui-workspace.client.js.patched` — 打过补丁的完整客户端 bundle（组件代码的权威来源）
- `reapply.py` — 一键重打补丁（从 patched 文件提取组件块，幂等）
- `README.md` — 本说明

## 原理

DSH 客户端插件 bundle 位于
`~/.npm/_npx/<hash>/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js`
（与 `~/.dsh/profiles/node_modules/...` 为同一文件，硬链接）。改动该文件后，DSH 内置的
`client-hmr` 插件（500ms 轮询 bundle 内容）自动检测并热替换浏览器端插件，
**无需重启 DSH 服务、无需刷新页面**（没生效就刷新一次）。

## 手动应用

```bash
# 自动定位 bundle 并打补丁（幂等）
python3 /Users/hungdavy/DSH/plugins/self-built/dsh-wechat-ui/reapply.py
# 或指定路径 + 手动覆盖
python3 reapply.py <path/to/client.js>
```

仓库内一键安装：见仓库根目录 `install.sh`。

## 注意事项

- 修改的是 DSH 运行时托管目录（npx 缓存），DSH 重装/升级会还原，届时重跑 `reapply.py` 即可。
- 微信会话 id 硬编码在组件里（`WECHAT_SESSION_IDS`），若桥接器重建会话（删除
  `~/.dsh-wechat/session.json` 后重扫码），需同步更新 id（改 patched 文件里的常量后重新拷贝即可）。
