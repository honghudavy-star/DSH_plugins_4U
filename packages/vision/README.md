# 识图（@dsh-plugins/vision）

DSH 原生组合插件。Host 侧注册 `/plugins/dsh-vision/analyze`，Web 侧在
`conversation.input.right` 注册“识图发送”按钮。

## 为什么这样实现

当前 DSH stable 会在 Host 准入层拒绝发往文本模型的 image block。本插件先把草稿图片交给
SiliconFlow `deepseek-ai/DeepSeek-OCR`，然后移除原始图片，以“用户问题 + 视觉分析结果”的
纯文本提交。因此无需修改 DSH runtime，也不会绕过模型能力检查。

## 安装与密钥

```bash
./install.sh vision
export SILICONFLOW_API_KEY="your-api-key"
npm exec --yes --package=@deepseek-ai/dsh@0.1.0-rc.6 -- dsh web
```

也可以用 DSH 的 credential provider 保存名为 `SILICONFLOW_API_KEY` 的凭据。插件只读取
凭据，不会把密钥写入包、日志或 profile patch。

## 使用

在 DSH 对话框粘贴或拖入 1–3 张图片，输入问题，点击“识图发送”。请求限制可在 DSH
插件配置中调整，包括图片数、单图大小、总请求大小、模型和重试次数。

`luma-mcp/build/` 保留图像预处理与 SiliconFlow 客户端实现；原有修改 npm 缓存与 profile
的安装补丁不再参与发布包。
