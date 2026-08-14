/**
 * 日志工具
 * 将日志输出到 stderr，避免污染 MCP 的 stdout JSON 通信
 */
declare class Logger {
    private logFilePath?;
    constructor();
    private initLogFile;
    private write;
    info(message: string, ...args: any[]): Promise<void>;
    error(message: string, ...args: any[]): Promise<void>;
    warn(message: string, ...args: any[]): Promise<void>;
    debug(message: string, ...args: any[]): Promise<void>;
}
export declare const logger: Logger;
/**
 * 重定向 console 到 logger，避免污染 stdout
 */
export declare function setupConsoleRedirection(): void;
export {};
//# sourceMappingURL=logger.d.ts.map