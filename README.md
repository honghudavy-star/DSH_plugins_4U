<div align="center">

# DSH Plugins 4U

**让 DeepSeek Harness 连接微信、拥有个性壁纸，也能读懂图片。**

<img src="docs/assets/readme-hero.jpg" alt="DeepSeek Harness 插件集合" width="100%">

</div>

DSH Plugins 4U 是一组面向 DeepSeek Harness（DSH）的社区插件。仓库根包提供统一的
“自定义插件”设置页，微信、壁纸和识图分别作为独立的 DSH 原生 bundle 安装、配置和启停。

本仓库当前默认兼容目标为 `@deepseek-ai/dsh@0.1.0-rc.6`。每个包都通过
`dsh.bundle.patch` 注册 Cordis Host；需要界面的包再通过 `dsh.client` 加载 Web 客户端模块。
整个过程不改写 DSH 安装目录、npm exec 缓存或已经构建的客户端 bundle。

> [!IMPORTANT]
> 本项目不是 DeepSeek Harness 官方插件。切换到其他 DSH 版本前，请先在测试 profile 中验证
> Host、客户端 Slot 和配置读写是否仍兼容。

[快速安装](#快速安装) · [首次使用](#首次使用) · [配置与数据](#配置与数据) ·
[开发与验证](#开发与验证) · [常见问题](#常见问题)

## 插件一览

| 包 | 功能 | DSH 扩展点 |
| --- | --- | --- |
| `@dsh-plugins/4u` | 仓库总插件；在“设置 → 插件”注册“自定义插件”页 | Cordis Host + `settings.plugins.tab` |
| `@dsh-plugins/wechat` | 微信与 DSH 会话双向桥接；提供微信会话快捷入口 | Cordis Host + `sidebar.footer.action` |
| `@dsh-plugins/wallpaper` | 使用预设或本地图片作为 DSH Web 背景 | Cordis Host + `webServer.tapIndex` |
| `@dsh-plugins/vision` | 先分析粘贴/拖入的图片，再把纯文本结果提交给模型 | Host HTTP route + `conversation.input.right` |

总插件只负责统一设置页，三个功能插件仍拥有各自的 Host、配置命名空间和生命周期。
因此可以只安装需要的功能，也可以单独停用某一项。

<img src="docs/assets/readme-scene.jpg" alt="DeepSeek Harness 插件使用场景" width="100%">

## 运行要求

- Git、Node.js 20 或更高版本，以及 npm。
- 已能正常运行的 DeepSeek Harness；安装器默认使用 `@deepseek-ai/dsh@0.1.0-rc.6`。
- 使用识图插件时，需要可用的 SiliconFlow API Key。
- 使用微信插件时，需要在首次启动时用手机微信扫码登录。

## 快速安装

安装全部三个功能插件：

```bash
git clone https://github.com/honghudavy-star/DSH_plugins_4U.git
cd DSH_plugins_4U
./install.sh
```

只安装指定功能插件（根包 `@dsh-plugins/4u` 始终会一起安装）：

```bash
./install.sh wechat
./install.sh wallpaper vision
```

可用名称为 `4u`、`wechat`、`wallpaper` 和 `vision`。默认安装到 `web` profile；可以通过
环境变量覆盖目标版本、profile、DSH 数据目录或 tarball 保存目录：

```bash
DSH_VERSION=0.1.0-rc.6 \
DSH_PROFILE=web \
DSH_HOME="$HOME/.dsh" \
DSH_PLUGIN_ARCHIVE_DIR="$HOME/.dsh/plugin-packages" \
./install.sh
```

安装器会对每个所选包执行 `npm pack`，把生成的 tarball 保存到
`$DSH_PLUGIN_ARCHIVE_DIR`，然后调用 DSH 官方插件入口：

```bash
dsh plugin --profile web add /absolute/path/to/plugin.tgz
```

安装完成后，停止并重新启动 DSH Web，让 Host 与客户端插件重新装载：

```bash
npm exec --yes --package=@deepseek-ai/dsh@0.1.0-rc.6 -- dsh web
```

随后进入“设置 → 插件 → 自定义插件”。页面会以三条可展开项目显示微信、壁纸和识图；
已安装功能的配置通过对应 Host 接口读取和保存，不需要手动编辑 `cordis.patch.yml`。

## 首次使用

### 微信

启用微信插件后，Host 会托管一个桥接子进程。首次运行时，二维码会直接输出到 DSH Web
所在终端；扫码后从微信发送一条消息，插件会创建或复用标题为“微信”的 DSH 会话，并把
agent 的最终回复发回微信。侧栏快捷入口会在该会话存在后出现。

在“自定义插件 → 微信”中可以设置：

- 是否启用桥接。
- 本地主动发送端口，默认为 `8790`。
- 固定的微信 owner ID；留空时由第一个成功收到的微信用户自动绑定。
- 固定的 DSH 会话 ID；留空时自动创建或复用“微信”会话。
- 是否自动调用识图插件分析微信入站图片。

配置保存后，桥接监督器会重新加载子进程。子进程异常退出时会自动重试；如果端口已被占用，
监督器会等待端口释放，避免启动重复实例。

桥接器还提供只监听 `127.0.0.1` 的主动发送接口。请求必须携带本地 Bearer token：

```bash
curl -s -X POST http://127.0.0.1:8790/send \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $(cat "$HOME/.dsh-wechat/bridge-token")" \
  -d '{"text":"通知内容"}'
```

发送文件时，在 JSON 中增加 `"file":"绝对路径"`。插件只接受现有的绝对路径普通文件，
拒绝相对路径、目录和符号链接。

[查看微信插件详细说明](packages/wechat/README.md)

### 壁纸

在“自定义插件 → 壁纸”中可以：

- 选择 `midnight`、`aurora`、`forest`、`sunset` 四个内置预设。
- 从文件选择器上传 PNG、JPEG、WebP 或 GIF。
- 填写本地图片绝对路径。
- 设置 `0` 到 `1` 的透明度，或直接停用壁纸。

上传内容会先检查媒体类型与文件签名，再以私有权限复制到插件数据目录。Host 在每次返回
DSH Web 首页时通过 `webServer.tapIndex` 注入一段受管 CSS，不修改客户端 bundle；保存后
刷新页面即可看到变化。

<table>
  <tr>
    <td align="center"><img src="packages/wallpaper/presets/midnight.png" alt="midnight 深夜蓝壁纸" width="210"><br><sub>midnight</sub></td>
    <td align="center"><img src="packages/wallpaper/presets/aurora.png" alt="aurora 极光壁纸" width="210"><br><sub>aurora</sub></td>
    <td align="center"><img src="packages/wallpaper/presets/forest.png" alt="forest 深林绿壁纸" width="210"><br><sub>forest</sub></td>
    <td align="center"><img src="packages/wallpaper/presets/sunset.png" alt="sunset 暮色壁纸" width="210"><br><sub>sunset</sub></td>
  </tr>
</table>

[查看壁纸插件详细说明](packages/wallpaper/README.md)

### 识图

在“自定义插件 → 识图”中填写 API Key，或在启动 DSH Web 前提供同名环境变量：

```bash
export SILICONFLOW_API_KEY="your-api-key"
npm exec --yes --package=@deepseek-ai/dsh@0.1.0-rc.6 -- dsh web
```

设置页还可以调整 Credential 名称、模型、每次图片数、单图大小、最大输出 Token、
Temperature 和失败重试次数。默认模型为 `deepseek-ai/DeepSeek-OCR`，默认每次最多 3 张图片，
单图上限 5 MiB。

使用时，在对话框中粘贴或拖入图片，输入问题，然后点击“识图发送”。客户端会把草稿图片交给
Host 的 `/plugins/dsh-vision/analyze` 路由；Host 返回视觉结果后，客户端移除原始图片草稿，
将“问题 + 视觉分析结果”作为纯文本提交给 DSH。

这样可以适配当前 stable Host 对文本模型 image block 的准入限制，也不会修改 DSH runtime
或绕过模型能力检查。支持 PNG、JPEG、WebP 和 GIF。

[查看识图插件详细说明](packages/vision/README.md)

## 配置与数据

| 项目 | 默认位置或来源 | 说明 |
| --- | --- | --- |
| 安装 tarball | `~/.dsh/plugin-packages/` | 可由 `DSH_HOME` 或 `DSH_PLUGIN_ARCHIVE_DIR` 覆盖 |
| 微信运行数据 | `~/.dsh-wechat/` | 登录凭据、owner、会话、同步游标、Bearer token、媒体和转发水位 |
| 壁纸上传文件 | `~/.dsh-plugins/wallpaper/uploads/` | 设置页上传的当前图片；目录和文件使用私有权限 |
| 壁纸 CLI 兼容状态 | `~/.dsh-plugins/wallpaper/config.json` | Host 在没有显式 `source` 配置时兼容读取 |
| 插件配置 | DSH settings 服务 | 使用 `dsh-plugins-wechat`、`dsh-plugins-wallpaper`、`dsh-plugins-vision` 命名空间 |
| 识图密钥 | DSH credential 或环境变量 | 默认 Credential 名称为 `SILICONFLOW_API_KEY`，保存后不回显 |

设置页的写接口要求同源请求和正确的 JSON/媒体类型。微信配置变化会重启其受管子进程；
识图配置即时用于后续请求；壁纸配置在刷新页面时生效。

## 安全边界

- 仓库和发布包不包含微信登录凭据或第三方 API Key。
- 微信桥接只接受单一 owner；本地主动发送接口只监听 `127.0.0.1`，并始终要求 Bearer token。
- 微信凭据目录和私密文件分别收紧为 `0700` 与 `0600`。
- 微信回复关联使用一次性 bridge origin，外发文件必须是非符号链接的绝对路径普通文件。
- 壁纸上传同时校验 Content-Type、文件签名和大小，不接受 SVG。
- 识图只接受 PNG、JPEG、WebP、GIF，并限制图片数量、单图体积和总请求体积。
- 所有插件通过公开的 Cordis 服务、DSH 路由或客户端 Slot 扩展，不修改 DSH build 产物。

## 升级与重新安装

更新仓库后重新运行安装器，即可重新打包并通过目标 profile 的官方插件管理器安装：

```bash
git pull --ff-only
./install.sh
```

如果只升级某个功能插件，可以只传对应名称。升级后重启 DSH Web；微信状态、壁纸上传和
DSH credential 均保存在仓库之外，不会因重新打包而写入 Git。

切换 DSH 版本时，请显式设置 `DSH_VERSION`，并优先使用独立 profile 验证：

```bash
DSH_VERSION=<目标版本> DSH_PROFILE=<测试-profile> ./install.sh
```

## 开发与验证

```bash
npm ci
npm test
npm pack --dry-run
npm pack --workspaces --if-present --dry-run
```

测试覆盖当前仓库最重要的插件契约：

- 四个包的 manifest、Cordis patch 和 Host 入口。
- 根设置页与微信/识图客户端 ModuleLoader bundle。
- 三个实时配置命名空间与配置接口。
- 壁纸注入、上传文件签名和大小边界。
- 微信端口占用检测、私密 token、owner/origin 和外发文件边界。

每个可安装包的核心结构如下：

```text
package.json         # dsh.bundle / 可选 dsh.client
cordis.patch.yml     # 向目标 profile 插入 Host Loader 行
index.mjs            # Host 插件：导出 apply(ctx, config)
client.js            # 需要 Web UI 时提供的 ModuleLoader bundle
README.md            # 插件级使用说明
```

仓库结构：

```text
DSH_plugins_4U/
├── index.mjs                    # 根 Host 入口（用于发现总插件客户端）
├── client.js                    # “自定义插件”统一设置页
├── cordis.patch.yml             # 根包 Loader patch
├── install.sh                   # 打包并调用 DSH 官方插件安装入口
├── docs/DSH_PLUGIN_SPEC.md      # DSH bundle、Cordis 与客户端准入说明
├── packages/
│   ├── wechat/                  # 微信 Host、侧栏入口和桥接器
│   ├── wallpaper/               # 壁纸 Host、预设和兼容 CLI
│   └── vision/                  # 识图 Host、输入按钮和预编译客户端
└── tests/plugin-format.test.mjs # 原生插件格式与安全边界回归测试
```

[查看 DSH 插件格式与 Cordis 准入规则](docs/DSH_PLUGIN_SPEC.md)

## 常见问题

<details>
<summary><strong>安装后看不到“自定义插件”页面怎么办？</strong></summary>
<br>
确认安装输出中包含 <code>@dsh-plugins/4u</code>，目标 <code>DSH_PROFILE</code> 与当前启动的
profile 一致，并完整停止后重新启动 DSH Web。仅刷新浏览器不会重新加载 Host 或客户端 bundle。
</details>

<details>
<summary><strong>微信没有显示二维码怎么办？</strong></summary>
<br>
二维码只在没有可复用登录凭据时输出到 DSH Web 所在终端。若日志显示会话已经过期，先停止
DSH，把 <code>~/.dsh-wechat/credentials.json</code> 移到备份位置，再重新启动并扫码；不要提交或分享该文件。
</details>

<details>
<summary><strong>微信桥接一直等待或无法启动怎么办？</strong></summary>
<br>
检查 DSH 终端中的 <code>dsh-plugins-wechat</code> 日志，并确认设置的桥接端口没有被其他进程占用。
插件检测到端口冲突时不会启动第二个桥接实例，而是按配置延迟重试。
</details>

<details>
<summary><strong>识图提示 Credential 未配置怎么办？</strong></summary>
<br>
在“自定义插件 → 识图”保存 API Key，或确保 <code>SILICONFLOW_API_KEY</code> 已导出到启动
DSH Web 的同一个进程环境。修改环境变量后需要重新启动 DSH Web。
</details>

<details>
<summary><strong>壁纸保存后没有变化怎么办？</strong></summary>
<br>
刷新 DSH Web 页面。若使用绝对路径，确认 Host 进程能够读取该文件；若使用上传，确认图片不超过
默认 10 MiB 限制，且真实文件内容与 PNG、JPEG、WebP 或 GIF 类型一致。
</details>

---

<div align="center">
  <sub>Built for people who want to keep their DSH setup reproducible.</sub>
</div>
