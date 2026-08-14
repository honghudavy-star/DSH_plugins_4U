/**
 * 通用 OpenAI 兼容 Provider 客户端
 * 支持任意 OpenAI 兼容端点（OpenAI、OpenRouter、Together AI、本地 vLLM/Ollama 等）
 */
import { OpenAICompatibleVisionClient } from "./openai-compatible-client.js";
function buildAuthHeaders(apiKey, authHeader, authHeaderValue) {
    const headers = {};
    if (authHeader === "bearer") {
        headers.Authorization = `Bearer ${apiKey}`;
    }
    else if (authHeader === "x-api-key") {
        headers["x-api-key"] = apiKey;
    }
    else {
        const headerTemplate = authHeaderValue ?? "";
        const value = headerTemplate.replace(/\{\{key\}\}/g, apiKey);
        const colonIndex = value.indexOf(":");
        if (colonIndex > 0) {
            const name = value.substring(0, colonIndex).trim();
            const val = value.substring(colonIndex + 1).trim();
            if (name)
                headers[name] = val;
        }
        else if (value) {
            headers[value] = apiKey;
        }
    }
    return headers;
}
export class CustomClient extends OpenAICompatibleVisionClient {
    customThinkingMode;
    constructor(config) {
        if (!config.customProvider) {
            throw new Error("CustomClient requires customProvider configuration. Set MODEL_PROVIDER=custom and provide CUSTOM_* environment variables.");
        }
        const cfg = config.customProvider;
        // Prefer CUSTOM_MODEL_NAME for request body (legacy: customProvider.model)
        const configWithModel = {
            ...config,
            model: cfg.model || config.model,
        };
        super(configWithModel, {
            displayName: "Custom",
            baseURL: cfg.baseUrl,
            path: cfg.path || "/chat/completions",
            timeoutMs: cfg.timeoutMs,
            headers: buildAuthHeaders(cfg.apiKey, cfg.authHeader, cfg.authHeaderValue),
            includeTopP: true,
            includeStreamFalse: true,
        });
        this.customThinkingMode = cfg.thinkingMode;
    }
    getModelName() {
        return `Custom (${this.model})`;
    }
    /**
     * Preserve custom provider thinking field shapes from v1.5.0.
     */
    applyThinking(body, enableThinking) {
        if (this.customThinkingMode === "disabled") {
            return;
        }
        if (enableThinking === false) {
            return;
        }
        if (this.customThinkingMode === "openai") {
            body.enable_thinking = true;
            return;
        }
        if (this.customThinkingMode === "qwen_extra_body") {
            body.extra_body = { enable_thinking: true };
        }
    }
}
//# sourceMappingURL=custom-client.js.map