/**
 * 智谱 GLM 视觉 API 客户端
 */
import { OpenAICompatibleVisionClient } from "./openai-compatible-client.js";
export class ZhipuClient extends OpenAICompatibleVisionClient {
    constructor(config) {
        super(config, {
            displayName: "GLM",
            endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
            timeoutMs: 60000,
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
            },
            thinkingMode: "openai_thinking_object",
            includeTopP: true,
        });
    }
}
//# sourceMappingURL=zhipu-client.js.map