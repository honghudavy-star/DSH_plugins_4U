/**
 * 硅基流动 DeepSeek-OCR API 客户端
 * OpenAI 兼容接口
 */
import { OpenAICompatibleVisionClient } from "./openai-compatible-client.js";
export class SiliconFlowClient extends OpenAICompatibleVisionClient {
    constructor(config) {
        super(config, {
            displayName: "DeepSeek",
            endpoint: "https://api.siliconflow.cn/v1/chat/completions",
            timeoutMs: 60000,
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
            },
            thinkingMode: "none",
            maxTokensCap: 4096,
            includeStreamFalse: true,
        });
    }
}
//# sourceMappingURL=siliconflow-client.js.map