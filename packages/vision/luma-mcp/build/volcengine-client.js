/**
 * 火山方舟 Doubao 视觉模型客户端
 */
import { OpenAICompatibleVisionClient } from "./openai-compatible-client.js";
export class VolcengineClient extends OpenAICompatibleVisionClient {
    constructor(config) {
        super(config, {
            displayName: "Doubao",
            endpoint: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
            timeoutMs: 120000,
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
            },
            thinkingMode: "openai_thinking_object",
            includeStreamFalse: true,
        });
    }
}
//# sourceMappingURL=volcengine-client.js.map