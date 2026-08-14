/**
 * 带重试机制的异步函数包装器
 * - 4xx 客户端错误直接抛出，不重试
 * - 其他错误使用带随机抖动的指数退避重试
 */
export declare function withRetry<T, P extends unknown[]>(fn: (...args: P) => Promise<T>, maxRetries?: number, initialDelay?: number): (...args: P) => Promise<T>;
/**
 * 检查字符串是否为 URL
 */
export declare function isUrl(source: string): boolean;
/**
 * 创建成功响应
 */
export declare function createSuccessResponse(data: string): {
    content: {
        type: "text";
        text: string;
    }[];
};
/**
 * 创建错误响应
 */
export declare function createErrorResponse(message: string): {
    content: {
        type: "text";
        text: string;
    }[];
    isError: boolean;
};
export interface CallMeta {
    provider: string;
    model: string;
    taskType: string;
    tileCount: number;
    multiCrop: boolean;
    preferText: boolean;
    preprocessMs: number;
    apiMs: number;
    totalMs: number;
}
/**
 * Optionally append machine-readable meta block for debugging / cost awareness.
 * Default off so host models still see plain analysis text.
 */
export declare function formatResultWithMeta(analysis: string, meta: CallMeta | undefined, includeMeta: boolean): string;
/**
 * Redact secrets from paths/URLs in user-facing errors
 */
export declare function sanitizeErrorMessage(message: string): string;
//# sourceMappingURL=helpers.d.ts.map