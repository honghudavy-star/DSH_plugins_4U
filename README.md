# DSH_plugins_4U — DSH 自建插件集合（按功能封装，一键安装）

DSH（DeepSeek Harness）自建插件的**源仓库 + 一键安装**。解决 DSH 重装/升级后
npx 缓存被还原、自建改动丢失的问题：所有插件按功能封装为 npm 包，本仓库统一保存。

> 开源仓库，**不含任何密钥/凭据**。运行时敏感数据（微信凭据 `~/.dsh-wechat/`、
> API Key `~/.dsh/profiles/web/cordis.patch.yml`）一律留在本机，不入库。

## 插件包（按功能封装）

| npm 包 | 功能 | 安装时自动做什么 |
|--------|------|------------------|
| `@dsh-plugins/wechat-ui` | DSH Web GUI 首页「微信」入口（微信 logo，单会话直显「微信对话」/ 多会话折叠 / 无会话隐藏） | 自动定位 DSH bundle 打补丁（幂等），HMR 热更新 |
| `@dsh-plugins/wechat-bridge` | 微信(官方 iLink) ⇄ DSH 桥接器：消息互转、图片/文件、断线自动重连与回复补发、主动发送接口 | 部署源码 → 安装依赖 → 生成 launchd plist → 启动服务 |

## 一键安装

```bash
git clone https://github.com/honghudavy-star/DSH_plugins_4U.git
cd DSH_plugins_4U
./install.sh
```

`install.sh` 会把每个包 `npm pack` 成 tarball 再全局安装——**安装时自动执行包的
install 脚本完成部署**（补丁/launchd 服务，幂等）。也可以只装某一个：

```bash
# 只装 GUI 微信入口补丁（真实安装，会自动执行部署脚本）
(cd packages/wechat-ui && npm pack) && npm install --global --foreground-scripts dsh-plugins-wechat-ui-*.tgz

# 只装桥接器服务
(cd packages/wechat-bridge && npm pack) && npm install --global --foreground-scripts dsh-plugins-wechat-bridge-*.tgz
```

> 注意：`npm install --global ./packages/wechat-ui`（本地路径）只会创建符号链接、
> **不会执行部署脚本**，请走上面的 tarball 方式或直接用 `./install.sh`。

安装后可手动重跑部署（幂等）：

```bash
npx dsh-plugins-wechat-ui            # 重打 UI 补丁（自动定位 bundle）
npx dsh-plugins-wechat-bridge        # 重部署桥接器服务
# 或不依赖 npm：
node packages/wechat-ui/reapply.mjs
node packages/wechat-bridge/install.mjs
```

环境变量（桥接器包）：

- `DSH_PLUGINS_RUNTIME_DIR` — 运行时安装目录（默认 `$HOME/DSH/plugins/self-built/dsh-wechat`）
- `DSH_PLUGINS_NODE` — launchd 使用的 node 路径（默认当前 node）

## 目录结构

```
DSH_plugins_4U/
├── install.sh                  # 一键安装全部
├── packages/
│   ├── wechat-ui/              # @dsh-plugins/wechat-ui
│   │   ├── reapply.mjs         #   补丁脚本（幂等）
│   │   └── dsh-client-ui-workspace.client.js.patched   # 组件权威文件
│   └── wechat-bridge/          # @dsh-plugins/wechat-bridge
│       ├── install.mjs         #   部署脚本（launchd 服务）
│       └── src/                #   桥接器源码 + 运行时 package.json
└── .gitignore                  # 排除凭据/依赖/日志
```

## 为什么 UI 是"补丁"而不是"插件"

首页会话列表（`dsh-client-ui-workspace`）目前没有对外暴露可注入分区的插件槽位，
客户端插件系统（`dsh.client` + slots）只能注入已声明槽位。因此 UI 采用
「直接补丁 bundle + 一键重打」：补丁随包保存，DSH 升级还原后重跑一次安装即可恢复。
若未来 DSH 新增相关槽位，可迁移为真正的客户端插件。

## 更新流程（维护者）

```bash
# 桥接器代码改动：
cp <运行时>/dsh-wechat-bridge.mjs packages/wechat-bridge/src/

# UI 组件改动：先改 packages/wechat-ui/dsh-client-ui-workspace.client.js.patched（组件权威来源），
# 拷贝到运行时 bundle 生效（reapply.mjs 会自动从 patched 提取补丁块）

# 版本号 + 提交：
(cd packages/wechat-ui && npm version patch)   # 按需
git add -A && git commit -m "..." && git push
```

> ⚠️ 提交前自查：`grep -rnE "(sk-|gho_|m0-|AKIA|BEGIN .*PRIVATE KEY)" .`
> 运行时目录 `~/.dsh-wechat/` 与 `~/.dsh/profiles/` 内的凭据严禁入库。
