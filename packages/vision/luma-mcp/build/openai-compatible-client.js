/**
 * Shared OpenAI-compatible vision client base.
 * Provider-specific clients only supply endpoint / thinking / token quirks.
 */
import axios from "axios";
import { buildImageContent } from "./vision-client.js";
import { logger } from "./utils/logger.js";
export class OpenAICompatibleVisionClient {
    client;
    model;
    maxTokens;
    temperature;
    topP;
    options;
    constructor(config, options) {
        this.model = config.model;
        this.maxTokens = config.maxTokens;
        this.temperature = config.temperature;
        this.topP = config.topP;
        this.options = {
            path: "",
            thinkingMode: "none",
            includeTopP: false,
            includeStreamFalse: false,
            ...options,
        };
        const axiosConfig = {
            timeout: options.timeoutMs ?? 60000,
            headers: {
                "Content-Type": "application/json",
                ...options.headers,
            },
        };
        if (options.endpoint) {
            axiosConfig.baseURL = options.endpoint;
        }
        else if (options.baseURL) {
            axiosConfig.baseURL = options.baseURL.replace(/\/+$/, "");
        }
        this.client = axios.create(axiosConfig);
    }
    buildRequestBody(imageDataUrl, prompt, enableThinking) {
        const maxTokens = this.options.maxTokensCap !== undefined
            ? Math.min(this.maxTokens, this.options.maxTokensCap)
            : this.maxTokens;
        const body = {
            model: this.model,
            messages: [
                {
                    role: "user",
                    content: [
                        ...buildImageContent(imageDataUrl),
                        {
                            type: "text",
                            text: prompt,
                        },
                    ],
                },
            ],
            temperature: this.temperature,
            max_tokens: maxTokens,
        };
        if (this.options.includeTopP) {
            body.top_p = this.topP;
        }
        if (this.options.includeStreamFalse) {
            body.stream = false;
        }
        this.applyThinking(body, enableThinking);
        return body;
    }
    applyThinking(body, enableThinking) {
        const mode = this.options.thinkingMode;
        if (mode === "none") {
            return;
        }
        if (mode === "openai_thinking_object") {
            if (enableThinking !== false) {
                body.thinking = { type: "enabled" };
            }
            return;
        }
        if (mode === "qwen_extra_body") {
            if (enableThinking !== false) {
                body.extra_body = {
                    enable_thinking: true,
                    thinking_budget: 81920,
                };
            }
            return;
        }
        if (mode === "enable_thinking_field" && enableThinking !== undefined) {
            body.enable_thinking = enableThinking;
        }
    }
    async analyzeImage(imageDataUrl, prompt, enableThinking) {
        const body = this.buildRequestBody(imageDataUrl, prompt, enableThinking);
        const imageCount = Array.isArray(imageDataUrl) ? imageDataUrl.length : 1;
        logger.info(`Calling ${this.options.displayName} API`, {
            model: this.model,
            thinking: this.describeThinking(body),
            imageCount,
        });
        try {
            const response = await this.client.post(this.options.path, body);
            const content = response.data?.choices?.[0]?.message?.content;
            if (!content) {
                throw new Error(`Invalid response from ${this.options.displayName}: missing choices[0].message.content`);
            }
            logger.info(`${this.options.displayName} API call successful`, {
                tokens: response.data.usage?.total_tokens ?? 0,
                model: response.data.model ?? this.model,
            });
            return content;
        }
        catch (error) {
            logger.error(`${this.options.displayName} API call failed`, {
                error: error instanceof Error ? error.message : String(error),
            });
            if (axios.isAxiosError(error)) {
                const message = error.response?.data?.error?.message || error.message;
                const status = error.response?.status;
                throw new Error(`${this.options.displayName} API error (${status || "unknown"}): ${message}`);
            }
            throw error;
        }
    }
    describeThinking(body) {
        return !!(body.thinking ||
            body.enable_thinking ||
            body.extra_body);
    }
    getModelName() {
        return `${this.options.displayName} (${this.model})`;
    }
}
//# sourceMappingURL=openai-compatible-client.js.map