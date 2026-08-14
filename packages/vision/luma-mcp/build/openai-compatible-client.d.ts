/**
 * Shared OpenAI-compatible vision client base.
 * Provider-specific clients only supply endpoint / thinking / token quirks.
 */
import { type AxiosInstance } from "axios";
import type { LumaConfig } from "./config.js";
import { type VisionClient } from "./vision-client.js";
export type ThinkingMode = "none" | "openai_thinking_object" | "enable_thinking_field" | "qwen_extra_body";
export interface OpenAICompatibleClientOptions {
    /** Display name prefix, e.g. "GLM", "Qwen" */
    displayName: string;
    /** Full chat completions URL, or baseURL + path below */
    endpoint?: string;
    /** Axios baseURL when using relative path */
    baseURL?: string;
    /** Relative path under baseURL (default "") */
    path?: string;
    timeoutMs?: number;
    headers?: Record<string, string>;
    thinkingMode?: ThinkingMode;
    /** Cap max_tokens sent to API */
    maxTokensCap?: number;
    /** Include top_p in request body */
    includeTopP?: boolean;
    /** Always send stream: false */
    includeStreamFalse?: boolean;
}
export declare class OpenAICompatibleVisionClient implements VisionClient {
    protected client: AxiosInstance;
    protected model: string;
    protected maxTokens: number;
    protected temperature: number;
    protected topP: number;
    protected options: Required<Pick<OpenAICompatibleClientOptions, "displayName" | "path" | "thinkingMode" | "includeTopP" | "includeStreamFalse">> & OpenAICompatibleClientOptions;
    constructor(config: LumaConfig, options: OpenAICompatibleClientOptions);
    protected buildRequestBody(imageDataUrl: string | string[], prompt: string, enableThinking?: boolean): Record<string, unknown>;
    protected applyThinking(body: Record<string, unknown>, enableThinking?: boolean): void;
    analyzeImage(imageDataUrl: string | string[], prompt: string, enableThinking?: boolean): Promise<string>;
    private describeThinking;
    getModelName(): string;
}
//# sourceMappingURL=openai-compatible-client.d.ts.map