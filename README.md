# DSH_plugins_4U — DSH 功能插件集合（按功能封装，一键安装）

DSH（DeepSeek Harness）自建功能的**源仓库 + 一键安装**。解决 DSH 重装/升级后
自建改动丢失的问题：每个功能封装为一个 npm 包，本仓库统一保存、一键部署。

> 开源仓库，**不含任何密钥/凭据**。运行时敏感数据（微信凭据 `~/.dsh-wechat/`、
> API Key `~/.dsh/profiles/web/cordis.patch.yml`）一律留在本机，不入库。

## 功能包

| # | 功能 | 包名 | 一句话说明 | 状态 |
|---|------|------|-----------|------|
| 1 | 🟢 微信 | `@dsh-plugins/wechat` | 手机微信 ⇄ 电脑 DSH 互相聊天（自动回复、图片文件、断线自动补发）+ 首页绿色微信快捷入口 | ✅ 已可用 |
| 2 | 🖼️ 更换背景壁纸 | `@dsh-plugins/wallpaper` | 一键更换 DSH 界面背景壁纸 | ⏳ 规划中 |
| 3 | 👁️ 识图 | `@dsh-plugins/vision` | 让 DSH 看懂图片（截图/粘贴图 → 自动识别描述） | ⏳ 规划中 |

## 一键安装

```bash
git clone https://github.com/honghudavy-star/DSH_plugins_4U.git
cd DSH_plugins_4U
./install.sh            # 装全部已发布的功能包
./install.sh wechat     # 或只装某一个
```

安装原理：`install.sh` 把每个包 `npm pack` 成 tarball 再全局安装——**安装时自动执行
包的 install 脚本完成部署**（启动服务/打补丁，幂等，重复安装安全）。

> 注意：`npm install --global ./packages/xxx`（本地路径）只会创建符号链接、
> **不会执行部署脚本**，请走 `./install.sh` 或 tarball 方式。

安装后可手动重跑部署（幂等）：

```bash
npx dsh-plugins-wechat        # 重新部署微信功能（聊天服务 + 首页入口）
```

## 目录结构

```
DSH_plugins_4U/
├── install.sh                  # 一键安装（默认全部，可指定包名）
├── packages/
│   └── wechat/                 # @dsh-plugins/wechat —— 微信功能
│       ├── install.mjs         #   部署脚本（幂等）
│       ├── src/                #   聊天服务源码（桥接器 + launchd）
│       └── ui/                 #   首页微信快捷入口（补丁 + 组件）
│   ├── wallpaper/              # （规划中）更换背景壁纸
│   └── vision/                 # （规划中）识图
└── .gitignore                  # 排除凭据/依赖/日志
```

## 为什么部分是"补丁"而不是"插件"

DSH 客户端插件系统（`dsh.client` + slots）只能注入官方声明的槽位；首页会话列表、
界面背景等目前没有对外暴露槽位，因此采用「直接补丁 bundle + 一键重打」：
补丁随包保存，DSH 升级还原后重跑安装即可恢复。若未来 DSH 新增槽位，可迁移为正式插件。

## 更新流程（维护者）

```bash
# 聊天服务代码改动：
cp <运行时>/dsh-wechat-bridge.mjs packages/wechat/src/

# UI 组件改动：先改 packages/wechat/ui/dsh-client-ui-workspace.client.js.patched（组件权威来源），
# 再同步到运行时 bundle 生效（reapply.mjs 从 patched 自动提取补丁块）

# 提交：
git add -A && git commit -m "..." && git push
```

> ⚠️ 提交前自查：`grep -rnE "(sk-|gho_|m0-|AKIA|BEGIN .*PRIVATE KEY)" .`
> 运行时目录 `~/.dsh-wechat/` 与 `~/.dsh/profiles/` 内的凭据严禁入库。
