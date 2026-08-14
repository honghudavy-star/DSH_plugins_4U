# DSH_plugins_4U — DSH 功能插件集合（按功能封装，一键安装）

DSH（DeepSeek Harness）自建功能的**源仓库 + 一键安装**。解决 DSH 重装/升级后
自建改动丢失的问题：每个功能封装为一个 npm 包，本仓库统一保存、一键部署。

> 开源仓库，**不含任何密钥/凭据**。运行时敏感数据（微信凭据 `~/.dsh-wechat/`、
> API Key `~/.dsh/profiles/web/cordis.patch.yml`）一律留在本机，不入库。

## 功能包

| # | 功能 | 包名 | 一句话说明 | 状态 |
|---|------|------|-----------|------|
| 1 | 🟢 微信 | `@dsh-plugins/wechat` | 手机微信 ⇄ 电脑 DSH 互相聊天（自动回复、图片文件、断线自动补发）+ 首页绿色微信快捷入口 | ✅ 已可用 |
| 2 | 🖼️ 更换背景壁纸 | `@dsh-plugins/wallpaper` | 一键给 DSH 换壁纸：内置 4 张预设/自选图片，可调透明度、一键关闭，即时生效 | ✅ 已可用 |
| 3 | 👁️ 识图 | `@dsh-plugins/vision` | 让 DSH 看懂图片：GUI 粘贴/拖拽图片 → 自动识别、描述、OCR | ✅ 已可用 |

## 一键安装

```bash
git clone https://github.com/honghudavy-star/DSH_plugins_4U.git
cd DSH_plugins_4U
./install.sh                 # 装全部功能
./install.sh wechat          # 或只装某一个（wechat / wallpaper / vision）
```

安装原理：`install.sh` 把每个包 `npm pack` 成 tarball 再全局安装——**安装时自动执行
包的 install 脚本完成部署**（启动服务/打补丁，幂等，重复安装安全）。

> 注意：`npm install --global ./packages/xxx`（本地路径）只会创建符号链接、
> **不会执行部署脚本**，请走 `./install.sh` 或 tarball 方式。

安装后可手动重跑部署（幂等）：

```bash
npx dsh-plugins-wechat        # 重新部署微信（聊天服务 + 首页入口）
npx dsh-plugins-wallpaper     # 重应用当前壁纸（set/list/off 见包内 README）
npx dsh-plugins-vision        # 重新部署识图（补丁 + 配置）
```

## 目录结构

```
DSH_plugins_4U/
├── install.sh                  # 一键安装（默认全部，可指定包名）
└── packages/
    ├── wechat/                 # @dsh-plugins/wechat —— 微信
    │   ├── install.mjs         #   部署：聊天服务（launchd）+ 首页快捷入口补丁
    │   ├── src/                #   聊天服务源码
    │   └── ui/                 #   首页微信快捷入口（补丁 + 组件）
    ├── wallpaper/              # @dsh-plugins/wallpaper —— 更换背景壁纸
    │   ├── wallpaper.mjs       #   CLI：set/list/off/apply/status
    │   └── presets/            #   内置 4 张预设壁纸
    └── vision/                 # @dsh-plugins/vision —— 识图
        ├── install.mjs         #   部署：luma-mcp + 补丁 + profile 配置
        ├── apply-patches.mjs   #   运行时补丁重放（幂等）
        ├── patch-profile.mjs   #   cordis.patch.yml 幂等写入（API Key 不入库）
        └── luma-mcp/           #   第三方识图服务（含本地补丁，不含 node_modules）
```

## 为什么部分是"补丁"而不是"插件"

DSH 客户端插件系统（`dsh.client` + slots）只能注入官方声明的槽位；首页会话列表、
界面背景等目前没有对外暴露槽位，因此采用「直接补丁 bundle + 一键重打」：
补丁随包保存，DSH 升级还原后重跑安装即可恢复。若未来 DSH 新增槽位，可迁移为正式插件。

## 更新流程（维护者）

```bash
# 聊天服务代码改动：
cp <运行时>/dsh-wechat-bridge.mjs packages/wechat/src/

# UI/组件改动：先改对应包里的权威文件（如 packages/wechat/ui/*.patched），
# 再同步到运行时 bundle 生效（reapply 脚本自动提取补丁块）

# 提交：
git add -A && git commit -m "..." && git push
```

> ⚠️ 提交前自查：`grep -rnE "(sk-|gho_|m0-|AKIA|BEGIN .*PRIVATE KEY)" .`
> 运行时目录 `~/.dsh-wechat/` 与 `~/.dsh/profiles/` 内的凭据严禁入库。
