<p align="center">
  <img src="https://img.shields.io/badge/DSH_Plugins-4U-4f46e5?style=for-the-badge" alt="DSH Plugins 4U"/>
  <img src="https://img.shields.io/badge/platform-macOS-333333?style=for-the-badge" alt="macOS"/>
  <img src="https://img.shields.io/badge/packages-3-0ea5e9?style=for-the-badge" alt="3 packages"/>
  <img src="https://img.shields.io/badge/status-all%20ready-brightgreen?style=for-the-badge" alt="all ready"/>
</p>

# 🧩 DSH_plugins_4U

> **给 DeepSeek Harness（DSH）装上「微信聊天 + 壁纸 + 识图」三个即装即用的功能包。**

自建 DSH 功能的**源仓库 + 一键安装**：每个功能封装为独立 npm 包，`install.sh` 一键部署、幂等可重跑，解决 DSH 重装 / 升级后自建改动丢失的问题。

---

## ✨ 功能总览

| | 微信 🟢 | 壁纸 🖼️ | 识图 👁️ |
|---|---|---|---|
| **一句话** | 手机微信 ⇄ 电脑 DSH 互相聊天 | 一键给 DSH 换背景壁纸 | 让 DSH 看懂粘贴的图片 |
| **亮点** | 自动回复、图片/文件互传、断线自动补发 | 4 张内置预设 / 自选图片、透明度可调 | 自动识别、描述、OCR 文字 |
| **入口** | 首页绿色微信按钮 | `dsh-plugins-wallpaper` 命令 | 对话框直接粘贴图片 |
| **状态** | ✅ 已可用 | ✅ 已可用 | ✅ 已可用 |
| **包名** | `@dsh-plugins/wechat` | `@dsh-plugins/wallpaper` | `@dsh-plugins/vision` |

---

## 🖼️ 效果预览（壁纸）

<details>
<summary>点击展开 4 张内置预设壁纸</summary>

| midnight · 深夜蓝 | aurora · 极光 | forest · 深林绿 | sunset · 暮色 |
|:---:|:---:|:---:|:---:|
| ![midnight](packages/wallpaper/presets/midnight.png) | ![aurora](packages/wallpaper/presets/aurora.png) | ![forest](packages/wallpaper/presets/forest.png) | ![sunset](packages/wallpaper/presets/sunset.png) |

</details>

---

## 🚀 快速开始

### 一键安装（全部功能）

```bash
git clone https://github.com/honghudavy-star/DSH_plugins_4U.git
cd DSH_plugins_4U
./install.sh                # 装全部三个功能
```

### 只装某一个

```bash
./install.sh wechat         # 或 wallpaper / vision
```

> ⚠️ 注意：`npm install --global ./packages/xxx`（本地路径）只会建符号链接、**不会执行部署脚本**；
> 请走 `./install.sh` 或 tarball 方式安装。

### 安装后手动重跑部署（幂等，放心重复执行）

```bash
npx dsh-plugins-wechat      # 重新部署微信（聊天服务 + 首页入口）
npx dsh-plugins-wallpaper   # 重应用当前壁纸
npx dsh-plugins-vision      # 重新部署识图（补丁 + 配置）
```

---

## 📦 功能详解

### 🟢 1. 微信 · `@dsh-plugins/wechat`

手机微信 ⇄ 电脑 DSH 互相聊天，一个包搞定微信相关的一切。

| 功能 | 说明 |
|------|------|
| 🗨️ 微信发消息 | 手机上发消息 → 电脑 DSH 收到并自动回答 |
| 📨 回复回微信 | DSH 的回答 → 自动发到你的微信 |
| 🖼️ 图片 / 📄 文件 | 微信发图/发文件电脑能看；DSH 也能把文件发回微信 |
| 🔔 主动通知 | 脚本/定时任务随时给微信发消息（提醒、日报等） |
| 🔁 断线自动恢复 | DSH 重启、网络抖动都不怕——自动重连，漏掉的回复自动补发 |
| 🟢 首页快捷入口 | 首页绿色微信按钮：单对话直显「微信对话」，多对话折叠，无对话自动隐藏 |

**第一次使用（仅一次）**：装完 `tail -f ~/.dsh-wechat/bridge.out.log` 等二维码，用手机微信「扫一扫」登录，然后在微信里发条消息试试。

**排障**：`launchctl kickstart -k gui/$(id -u)/com.dsh.wechatbridge` 重启服务；日志在 `~/.dsh-wechat/`。完整说明见 [packages/wechat/README.md](packages/wechat/README.md)。

---

### 🖼️ 2. 更换背景壁纸 · `@dsh-plugins/wallpaper`

一条命令给 DSH 换壁纸，装完立刻看到效果（半透明浮层，不影响按钮/文字/操作）。

| 命令 | 作用 |
|------|------|
| `dsh-plugins-wallpaper list` | 查看内置预设 |
| `dsh-plugins-wallpaper set aurora` | 换预设壁纸（midnight / aurora / forest / sunset） |
| `dsh-plugins-wallpaper set ~/Pictures/星空.jpg` | 用自己的图片 |
| `dsh-plugins-wallpaper set forest --opacity 0.5` | 调节透明度（默认 0.3） |
| `dsh-plugins-wallpaper off` | 一键关闭 |
| `dsh-plugins-wallpaper status` | 查看当前状态 |

> ⚡ 换完**即时生效**（HMR 热更新），不用重启、不用刷新。完整说明见 [packages/wallpaper/README.md](packages/wallpaper/README.md)。

---

### 👁️ 3. 识图 · `@dsh-plugins/vision`

让 DSH 看懂图片——文本模型看不见图？装了这个包之后：

1. 📋 在 DSH 界面**直接粘贴 / 拖拽一张图片**
2. 👁️ agent 自动调用 `image_understand` 工具识图，基于图片内容回答
3. 🔤 支持 **OCR 逐字提取文字**、描述图片内容、分析截图

**安装时自动完成**：部署识图服务（luma-mcp，SiliconFlow + DeepSeek-OCR，免费额度可用）→ 打全运行时补丁 → 写入 DSH 配置。

> 🔑 首次安装会提示输入 **SiliconFlow API Key**（免费申请：https://platform.siliconflow.cn ），
> 或先 `export SILICONFLOW_API_KEY=你的Key` 再安装。**Key 只存在本机，不会进仓库。**
>
> ⚠️ 装完**需要重启 DSH** 生效：停掉 `dsh web` 后重新 `npm exec @deepseek-ai/dsh web`。

完整说明见 [packages/vision/README.md](packages/vision/README.md)。

---

## 🛠️ 工作原理：为什么是「补丁」而不是「插件」

DSH 客户端插件系统（`dsh.client` + slots）只能注入官方声明的槽位；**首页会话列表、界面背景等目前没有对外暴露槽位**，因此采用「直接补丁 bundle + 一键重打」：

- 补丁随包保存，DSH 升级还原后**重跑安装即可恢复**
- 若未来 DSH 新增对应槽位，可平滑迁移为正式插件

---

## 🔐 安全说明

- 本仓库为**开源仓库，不含任何密钥 / 凭据**
- 运行时敏感数据一律留在本机，不入库：
  - 微信凭据 → `~/.dsh-wechat/`
  - API Key → `~/.dsh/profiles/web/cordis.patch.yml`

---

## 📁 目录结构

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

---

## ❓ FAQ

**Q：DSH 升级后功能失效了？**
A：DSH 升级会还原 npx 缓存 / bundle。重跑一遍安装即可：`npx dsh-plugins-<功能名>` 或 `./install.sh`。

**Q：重复安装安全吗？**
A：安全。所有部署脚本幂等，重复安装不会产生副作用。

**Q：微信需要一直开着电脑吗？**
A：聊天服务由 macOS launchd 托管，开机自启、后台常驻；DSH 重启会自动重连并补发漏掉的回复。

---

## 📝 维护

```bash
# 聊天服务代码改动后同步回仓库：
cp <运行时>/dsh-wechat-bridge.mjs packages/wechat/src/

# 提交（提交前自查：grep -rnE "(sk-|gho_|m0-|AKIA|BEGIN .*PRIVATE KEY)" .）
git add -A && git commit -m "..." && git push
```

## 📄 License

MIT
