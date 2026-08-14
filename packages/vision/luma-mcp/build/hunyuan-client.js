/**
 * 腾讯混元视觉 API 客户端
 * OpenAI 兼容接口
 */
import { OpenAICompatibleVisionClient } from "./openai-compatible-client.js";
export class HunyuanClient extends OpenAICompatibleVisionClient {
    constructor(config) {
        super(config, {
            displayName: "Hunyuan",
            baseURL: "https://api.hunyuan.cloud.tencent.com/v1",
            path: "/chat/completions",
            timeoutMs: 180000,
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
            },
            thinkingMode: "enable_thinking_field",
            includeTopP: true,
        });
    }
}
//# sourceMappingURL=hunyuan-client.js.map