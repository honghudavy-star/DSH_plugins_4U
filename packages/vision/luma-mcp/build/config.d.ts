/**
 * 配置模块
 * 从环境变量加载配置
 */
export type ModelProvider = "zhipu" | "siliconflow" | "qwen" | "volcengine" | "hunyuan" | "custom";
export declare const SUPPORTED_PROVIDERS: ModelProvider[];
export interface CustomProviderConfig {
    apiKey: string;
    baseUrl: string;
    model: string;
    authHeader: "bearer" | "x-api-key" | "custom";
    authHeaderValue?: string;
    path: string;
    timeoutMs: number;
    thinkingMode: "disabled" | "openai" | "qwen_extra_body";
}
export interface LumaConfig {
    provider: ModelProvider;
    apiKey: string;
    model: string;
    maxTokens: number;
    temperature: number;
    topP: number;
    enableThinking: boolean;
    multiCrop: boolean;
    multiCropMaxTiles: number;
    baseVisionPrompt?: string;
    /** Append preprocess/API timing metadata to tool results */
    includeMeta: boolean;
    customProvider?: CustomProviderConfig;
}
/**
 * 从环境变量加载配置（保持既有 env 名兼容）
 */
export declare function loadConfig(): LumaConfig;
/**
 * Provider env key name for user-facing warnings
 */
export declare function getProviderApiKeyEnvName(provider: ModelProvider): string;
//# sourceMappingURL=config.d.ts.map