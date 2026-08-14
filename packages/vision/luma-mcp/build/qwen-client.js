/**
 * 阿里云 Qwen VL 客户端
 * OpenAI 兼容接口
 */
import { OpenAICompatibleVisionClient } from "./openai-compatible-client.js";
export class QwenClient extends OpenAICompatibleVisionClient {
    constructor(config) {
        super(config, {
            displayName: "Qwen",
            baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
            path: "/chat/completions",
            timeoutMs: 180000,
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
            },
            thinkingMode: "qwen_extra_body",
            includeStreamFalse: true,
        });
    }
}
//# sourceMappingURL=qwen-client.js.map