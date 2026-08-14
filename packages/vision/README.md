# 识图（@dsh-plugins/vision）

> 让 DSH 看懂图片：截图/粘贴图 → 自动识别、描述、OCR 文字。

## 这是什么？

DSH 用的文本模型本身看不见图。装了这个功能包后：

- 📋 在 DSH 界面**直接粘贴/拖拽一张图片**
- 👁️ agent 会自动调用 `image_understand` 工具识图，然后基于图片内容回答
- 🔤 支持 OCR 逐字提取文字、描述图片内容、分析截图

## 怎么安装

```bash
npm pack ./packages/vision && npm install --global --foreground-scripts dsh-plugins-vision-*.tgz
```

安装时自动完成：

1. 部署识图服务（luma-mcp，SiliconFlow + DeepSeek-OCR，**免费额度可用**）
2. 打好全部运行时补丁（图片不再被拒绝、路径白名单、无扩展名附件识别等）
3. 写入 DSH 配置（`image_understand` 工具 + agent 识图指令）

> 🔑 API Key：首次安装会提示输入 **SiliconFlow API Key**（免费申请：
> https://platform.siliconflow.cn ）。也可以先设环境变量
> `SILICONFLOW_API_KEY=sk-xxx` 再安装。**Key 只存在你本机**，不会进仓库。

## 第一次用

装完**需要重启 DSH**（配置和底层补丁要重启才加载）：

```bash
# 停掉当前 dsh web（终端 Ctrl+C），再重新启动：
npm exec @deepseek-ai/dsh web
```

重启后：在 DSH 对话框**粘贴一张图片**（Cmd+V 或拖拽），agent 会自动识图回答。

## 出问题了怎么办

- 重跑一遍安装（幂等）：`npx dsh-plugins-vision`
- DSH 升级后识图失效（npx 缓存被还原）：重跑安装即可恢复
- 图片路径读不了：确认环境变量 `LUMA_ALLOW_ANY_PATH=1` 还在配置里（重跑安装会补）

## 技术细节（给维护者）

- `luma-mcp/` — 第三方识图服务（含本地补丁的 build，不含 node_modules，安装时装依赖）
- `apply-patches.mjs` — 运行时补丁重放（luma 白名单/魔数嗅探 + npx 缓存里的
  dsh-llm-deepseek 图片压平 + dsh-host-apiproxy 受理门放行），幂等
- `patch-profile.mjs` — `~/.dsh/profiles/web/cordis.patch.yml` 幂等写入
  （mcp-vision + persona 识图指令；API Key 复用已有配置/环境变量/交互输入，不入库）
