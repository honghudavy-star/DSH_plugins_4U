/**
 * 通用 OpenAI 兼容 Provider 客户端
 * 支持任意 OpenAI 兼容端点（OpenAI、OpenRouter、Together AI、本地 vLLM/Ollama 等）
 */
import type { LumaConfig } from "./config.js";
import { OpenAICompatibleVisionClient } from "./openai-compatible-client.js";
export declare class CustomClient extends OpenAICompatibleVisionClient {
    private customThinkingMode;
    constructor(config: LumaConfig);
    getModelName(): string;
    /**
     * Preserve custom provider thinking field shapes from v1.5.0.
     */
    protected applyThinking(body: Record<string, unknown>, enableThinking?: boolean): void;
}
//# sourceMappingURL=custom-client.d.ts.map