# Luma MCP

多模型视觉理解 MCP 服务器，为不支持原生视觉能力的 AI 助手提供统一的图片分析能力。

[English](./docs/README_EN.md) | 中文

## 特性

- **多模型支持**：GLM-4.6V、DeepSeek-OCR、Qwen3-VL-Flash、Doubao-Seed-1.6、Hunyuan-Vision
- **单工具设计**：统一通过 `image_understand` 完成图片理解，兼容旧客户端
- **面向复杂截图优化**：大图自动多裁剪、文本密集场景保真处理
- **统一预处理链路**：本地文件、远程 URL、Data URI 都进入同一套处理流程
- **适用场景完整**：代码截图、UI 截图、报错截图、文档截图、OCR
- **标准 MCP 协议**：可接入 Claude Desktop、Cline、Claude Code 等客户端
- **HTTP / Docker 部署**：局域网内多客户端共享一个实例（v1.7.0+）
- **内置重试**：降低临时网络或模型请求失败带来的影响

## 快速开始

### 前置要求

- Node.js >= 18
- 任意一个模型提供商的 API Key

### 安装

直接通过 `npx` 运行（无需本地安装）：

```bash
npx -y luma-mcp
```

或从源码构建：

```bash
git clone https://github.com/JochenYang/luma-mcp.git
cd luma-mcp
npm install
npm run build
```

## 不使用 MCP？Luma Vision Skill（轻量替代）

不想安装 MCP 服务器，或你使用的 AI 客户端（如 Kimi Code）支持 skill 而不支持 MCP？可直接使用仓库内的 `vision-skill/`：

- **安装**：把 `vision-skill/` 目录复制到你所用 agent 的 skills 目录（如 `~/.agents/skills/vision-skill`）
- **激活**：发送图片时以 `/skill luma-vision` 开头，skill 会执行 `scripts/vision.js` 直连视觉模型 API 完成分析
- **配置**：在系统环境变量中设置（与 MCP 版 `custom` provider 共用同一组变量）：

| 变量 | 说明 |
| ---- | ---- |
| `CUSTOM_BASE_URL` | OpenAI 兼容 API 地址（默认 `https://api.minimaxi.com/v1`） |
| `CUSTOM_MODEL_NAME` | 模型名称（默认 `MiniMax-M3`） |
| `CUSTOM_API_KEY` | API Key |

**与 MCP 版的差异**：skill 是零依赖轻量脚本，只做"单图直连"——支持本地路径、HTTP(S) URL、Data URI，图片参数留空时自动扫描常见缓存目录找最新图片；但不包含 MCP 版的多裁剪、压缩、重试、SSRF 防护等能力。

## 配置

### 基础配置（npx 方式）

在 MCP 客户端的 `mcpServers` 中注册（Claude Desktop、Cline / VSCode 通用）：

```json
{
  "mcpServers": {
    "luma": {
      "command": "npx",
      "args": ["-y", "luma-mcp"],
      "env": {
        "MODEL_PROVIDER": "zhipu",
        "ZHIPU_API_KEY": "your-api-key"
      }
    }
  }
}
```

将 `MODEL_PROVIDER` 与对应的 API Key 环境变量替换为实际使用的提供商：

| `MODEL_PROVIDER` | API Key 环境变量 |
| ---------------- | ---------------- |
| `zhipu` | `ZHIPU_API_KEY` |
| `siliconflow` | `SILICONFLOW_API_KEY` |
| `qwen` | `DASHSCOPE_API_KEY` |
| `volcengine` | `VOLCENGINE_API_KEY` |
| `hunyuan` | `HUNYUAN_API_KEY` |
| `custom` | `CUSTOM_API_KEY` + `CUSTOM_BASE_URL` + `CUSTOM_MODEL_NAME` |

默认模型见[提供商密钥](#提供商密钥)表；如需覆盖模型，可追加 `MODEL_NAME` 环境变量，例如：

- `MODEL_NAME=doubao-seed-1-6-vision-250815`（Volcengine 视觉深度思考模型）
- `MODEL_NAME=hy-vision-2.0-instruct`（Hunyuan，腾讯云 TokenHub）

> [!NOTE]
> **混元模型已迁移**：腾讯混元平台的旧视觉模型（`hunyuan-t1-vision-20250916`、`Tencent HY Vision 1.5 Instruct` 等）已于 2026-06-22 下线，新模型（HY-Vision 2.0 等）迁移至[腾讯云 TokenHub](https://cloud.tencent.com/product/tokenhub)。luma 的 `hunyuan` provider 默认端点仍指向旧平台；改用 TokenHub 新模型时，建议以 `custom` provider 接入，将 `CUSTOM_BASE_URL` 设为 `https://tokenhub.tencentmaas.com/v1`。

### Claude Code 快捷命令

```bash
# Zhipu
claude mcp add -s user luma-mcp --env MODEL_PROVIDER=zhipu --env ZHIPU_API_KEY=your-api-key -- npx -y luma-mcp

# SiliconFlow
claude mcp add -s user luma-mcp --env MODEL_PROVIDER=siliconflow --env SILICONFLOW_API_KEY=your-api-key -- npx -y luma-mcp

# Qwen
claude mcp add -s user luma-mcp --env MODEL_PROVIDER=qwen --env DASHSCOPE_API_KEY=your-api-key -- npx -y luma-mcp

# Volcengine
claude mcp add -s user luma-mcp --env MODEL_PROVIDER=volcengine --env VOLCENGINE_API_KEY=your-api-key --env MODEL_NAME=doubao-seed-1-6-vision-250815 -- npx -y luma-mcp

# Hunyuan（新模型在腾讯云 TokenHub，旧混元平台模型已下线）
claude mcp add -s user luma-mcp --env MODEL_PROVIDER=hunyuan --env HUNYUAN_API_KEY=your-api-key --env MODEL_NAME=hy-vision-2.0-instruct -- npx -y luma-mcp
```

### 本地开发模式

指向本地 `build/index.js`（将 `<项目路径>` 替换为你本机的项目绝对路径）：

```json
{
  "mcpServers": {
    "luma": {
      "command": "node",
      "args": ["<项目路径>/build/index.js"],
      "env": {
        "MODEL_PROVIDER": "zhipu",
        "ZHIPU_API_KEY": "your-api-key"
      }
    }
  }
}
```

若 MCP 客户端支持设置工作目录，也可直接使用相对路径 `build/index.js` 并把 cwd 指向项目根目录。

### HTTP / Docker 部署（局域网共享，v1.7.0+）

默认走 stdio（本地进程）。需要局域网内多个客户端共享一个实例时，改用 **Streamable HTTP** 传输：

```bash
# 本地直接运行（HTTP 模式）
MCP_TRANSPORT=http MCP_HTTP_PORT=3000 MCP_HTTP_TOKEN=your-token node build/index.js
```

Docker 部署：

```bash
docker build -t luma-mcp .
docker run -d --name luma-mcp -p 3000:3000 \
  -e MODEL_PROVIDER=zhipu \
  -e ZHIPU_API_KEY=your-api-key \
  -e MCP_HTTP_TOKEN=your-token \
  luma-mcp
```

客户端配置（Claude Desktop / Cline 等支持 URL 方式的客户端）：

```json
{
  "mcpServers": {
    "luma": {
      "type": "http",
      "url": "http://<服务器IP>:3000/mcp",
      "headers": {
        "Authorization": "Bearer your-token"
      }
    }
  }
}
```

> [!IMPORTANT]
> **务必设置 `MCP_HTTP_TOKEN`**：HTTP 模式下任何能访问该端口的人都能调用 `image_understand`，消耗你的模型 API 额度。
>
> **图片来源限制**：HTTP 模式下 `image_source` 只支持 HTTP(S) URL 与 Data URI，**本地文件路径不可用**（服务端在远端，读不到客户端文件）；Data URI 传入的图片上限约 10MB（受请求体 30MB 限制）。

### Custom Provider（v1.5.0+）

使用任意 OpenAI 兼容端点（OpenAI、OpenRouter、Together AI、Anthropic 代理、本地 vLLM/Ollama 等）：

```bash
claude mcp add -s user luma-mcp \
  --env MODEL_PROVIDER=custom \
  --env CUSTOM_API_KEY=sk-your-key \
  --env CUSTOM_BASE_URL=https://your-endpoint.com/v1 \
  --env CUSTOM_MODEL_NAME=your-model \
  -- npx -y luma-mcp
```

可选配置（都有默认值）：

- `CUSTOM_AUTH_HEADER=bearer` — `bearer` / `x-api-key` / `custom`
- `CUSTOM_PATH=/chat/completions` — API 路径
- `CUSTOM_TIMEOUT_MS=60000` — 超时毫秒
- `CUSTOM_THINKING_MODE=disabled` — `disabled` / `openai` / `qwen_extra_body`
- `CUSTOM_AUTH_HEADER_VALUE="X-API-Key: {{key}}"` — 自定义 Header 模板（`{{key}}` 会被替换为 API Key）

## 使用

### `image_understand`

**单一工具**，参数：

| 参数 | 必填 | 说明 |
| ---- | ---- | ---- |
| `image_source` | 是 | 粘贴路径、本地文件路径、HTTP(S) 图片 URL 或 Data URI |
| `prompt` | 是 | 用户对图片的原始问题，无需手写长分析模板 |
| `task_type` | 否 | `auto` \| `general` \| `ocr` \| `ui` \| `debug` \| `describe` |

`task_type` 行为：

- 省略或 `auto`（默认）：与旧版一致，按 prompt 启发式路由
- `ocr`：文字提取，默认单图高保真（关闭 multi-crop）
- `ui` / `debug`：界面结构 / 报错截图，倾向文本保真
- `describe`：简短描述

示例：

```typescript
image_understand({
  image_source: "./screenshot.png",
  prompt: "分析这个页面的布局和主要组件结构",
  task_type: "ui",
});

image_understand({
  image_source: "./code-error.png",
  prompt: "这段代码为什么报错？请给出修复建议",
  // task_type 可省略，行为与旧版兼容
});

image_understand({
  image_source: "https://example.com/ui.png",
  prompt: "找出这个界面的可用性问题",
});
```

### 使用建议

- 非视觉模型需要明确提示调用 MCP 工具
- 代码截图、OCR、长图、表格这类文本密集图片会自动启用更保真的处理方式
- 大图会按配置自动生成原图加裁剪图，提高细节理解能力
- 需要排查耗时/裁剪数时设 `INCLUDE_META=true` 或 `LUMA_DEBUG=1`，结果末尾会附 `luma_meta`

## 环境变量

### 通用配置

| 变量名 | 默认值 | 说明 |
| ------ | ------ | ---- |
| `MODEL_PROVIDER` | `zhipu` | 模型提供商：`zhipu`、`siliconflow`、`qwen`、`volcengine`、`hunyuan`、`custom` |
| `MODEL_NAME` | 自动选择 | 模型名称覆盖 |
| `MAX_TOKENS` | `8192` | 最大生成 token 数（部分模型有硬上限，见下方说明） |
| `TEMPERATURE` | `0.7` | 采样温度 |
| `TOP_P` | `0.95` | 核采样阈值 |
| `ENABLE_THINKING` | `true` | 思考模式，设为 `false` 关闭 |
| `MULTI_CROP` | `true` | 大图多裁剪，设为 `false` 关闭 |
| `MULTI_CROP_MAX_TILES` | `5` | 多裁剪最大图块数（含原图，1–16） |
| `BASE_VISION_PROMPT` | 内置默认值 | 自定义基础视觉提示词（设为空字符串可关闭） |
| `INCLUDE_META` | `false` | 为 `true` 时在工具结果末尾附加预处理/API 耗时等 meta |
| `LUMA_DEBUG` | 关闭 | `1`/`true` 时等同开启 `INCLUDE_META` |
| `MCP_TRANSPORT` | `stdio` | 传输方式：`stdio`（默认）或 `http`（Streamable HTTP） |
| `MCP_HTTP_HOST` | `0.0.0.0` | HTTP 模式监听地址（Docker 内需为 `0.0.0.0`） |
| `MCP_HTTP_PORT` | `3000` | HTTP 模式监听端口 |
| `MCP_HTTP_TOKEN` | 空（不鉴权） | HTTP 模式 Bearer token；**局域网共享务必设置** |

> [!IMPORTANT]
> **关于 Token 限制的特别说明：**
>
> 1. **SiliconFlow (DeepSeek-OCR)**: 该模型的总上下文长度（输入+输出）仅为 **8192**。为了确保图片能正常输入，Luma 已在客户端内部将 `MAX_TOKENS` 硬性限制在 **4096** 以内。即使你在环境变量中设置了更高的值，也会被截断。
> 2. **通用建议**: 视觉理解任务通常不需要极长的输出。对于大多数模型，建议将 `MAX_TOKENS` 保持在 `4096` 或 `8192`。设置过高（如 `16384`）在处理大图时，可能因总长度超过模型上限而导致 `400` 错误。

### 提供商密钥

| 提供商 | 必填环境变量 | 默认模型 |
| ------ | ------------ | -------- |
| Zhipu | `ZHIPU_API_KEY` | `glm-4.6v` |
| SiliconFlow | `SILICONFLOW_API_KEY` | `deepseek-ai/DeepSeek-OCR` |
| Qwen | `DASHSCOPE_API_KEY` | `qwen3-vl-flash` |
| Volcengine | `VOLCENGINE_API_KEY` | `doubao-seed-1-6-flash-250828` |
| Hunyuan | `HUNYUAN_API_KEY` | `hunyuan-t1-vision-20250916` |

## 图片限制与处理

- 支持格式：JPG、PNG、WebP、GIF
- 最大输入大小：10MB（本地文件、远程 URL、Data URI 一致）
- 超过 2MB 的图片会自动压缩
- 最大分辨率：1600 万像素（超出将报错）
- 远程 URL 会先拉取到统一预处理链路再发送给模型，并带 SSRF 防护（拒绝内网/私网地址、禁用重定向）
- 长边 ≥ 1800px 或 ≥ 350 万像素的大图，自动生成原图 + 有序裁剪图（受 `MULTI_CROP` / `MULTI_CROP_MAX_TILES` 控制）

## 本地测试

```bash
# 单元测试（不调用真实 API）
npm run test:unit

# MCP stdio 端到端测试（真实调用 image_understand）
npm run test:mcp

# MCP HTTP 传输测试（无需 API key）
npm run test:http

# 基础测试
npm run test:local ./test.png

# 带问题测试
npm run test:local ./code-error.png "这段代码为什么报错？"

# 远程图片测试
npm run test:local https://example.com/image.jpg

# 检查源码和测试脚本类型
npm run typecheck
```

## 模型选择建议

- OCR、文字识别：DeepSeek-OCR
- 快速低成本通用分析：Qwen3-VL-Flash
- 高性价比通用分析：Doubao-Seed-1.6
- 深度图片理解：GLM-4.6V
- 复杂图文推理、多语言：Hunyuan-Vision（新模型为混元 HY-Vision，见腾讯云 TokenHub）

## 项目结构

```text
luma-mcp/
├── src/
│   ├── index.ts                      # MCP 服务器入口，注册 image_understand
│   ├── http-server.ts                # Streamable HTTP 传输层（鉴权/会话/CORS）
│   ├── config.ts                     # 环境变量加载与校验
│   ├── constants.ts                  # 默认视觉提示词等常量
│   ├── task-types.ts                 # 可选 task_type 路由
│   ├── vision-client.ts              # 视觉模型客户端接口
│   ├── openai-compatible-client.ts   # OpenAI 兼容请求基类
│   ├── zhipu-client.ts               # GLM-4.6V 客户端
│   ├── siliconflow-client.ts         # DeepSeek-OCR 客户端
│   ├── qwen-client.ts                # Qwen3-VL 客户端
│   ├── volcengine-client.ts          # Doubao-Seed-1.6 客户端
│   ├── hunyuan-client.ts             # Hunyuan-Vision 客户端
│   ├── custom-client.ts              # 任意 OpenAI 兼容端点
│   ├── image-processor.ts            # 图片预处理、压缩、多裁剪
│   └── utils/
│       ├── helpers.ts                # 重试、响应格式化、错误脱敏
│       └── logger.ts                 # 日志
├── test/
│   ├── test-local.ts                 # 本地单图/多图测试
│   ├── test-qwen.ts                  # Qwen 客户端测试
│   ├── test-deepseek-raw.ts          # DeepSeek-OCR 原始调用测试
│   ├── test-data-uri.ts              # Data URI 处理测试
│   ├── test-custom.ts                # CustomClient 单元测试
│   ├── test-task-types.ts            # task_type 路由测试
│   ├── test-mcp-stdio.ts             # MCP stdio 端到端测试
│   ├── test-mcp-http.ts              # MCP HTTP 传输测试（无需 API key）
│   └── image-processor-regression.ts # 图片处理回归测试
├── Dockerfile                        # HTTP 模式容器化部署
├── vision-skill/                     # 轻量识图 skill（无 MCP 用户的替代方案）
│   ├── SKILL.md                      # skill 定义：/skill luma-vision 激活
│   └── scripts/vision.js             # 零依赖识图脚本，直连视觉模型 API
├── docs/
│   └── README_EN.md
├── build/                            # 编译产物
├── package.json
└── tsconfig.json
```

## 开发

```bash
npm run watch
npm run build
npm run typecheck
```

## 相关链接

- [智谱开放平台](https://open.bigmodel.cn/)
- [硅基流动平台](https://cloud.siliconflow.cn/)
- [阿里云百炼](https://bailian.console.aliyun.com/)
- [火山方舟](https://console.volcengine.com/ark)
- [腾讯混元](https://cloud.tencent.com/product/hunyuan)
- [MCP 协议](https://modelcontextprotocol.io/)

## 更新历史

[CHANGELOG.md](./CHANGELOG.md)

## 许可证

MIT
