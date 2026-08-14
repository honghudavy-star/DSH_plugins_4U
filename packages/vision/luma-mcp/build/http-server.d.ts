/**
 * HTTP MCP 传输层（Streamable HTTP）
 *
 * 支持局域网共享 / Docker 部署：
 * - 有状态会话管理（SDK 自动生成 session id，按 TTL 清理防内存泄漏）
 * - 可选 Bearer token 鉴权（MCP_HTTP_TOKEN）
 * - CORS 支持（浏览器客户端）
 * - 健康检查端点（Docker HEALTHCHECK / 连通性验证）
 */
import { type Server } from "http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export interface HttpServerOptions {
    /** 服务版本号，用于健康检查响应 */
    version: string;
    /** 可选 Bearer token；设置后所有请求必须携带 Authorization: Bearer <token> */
    token?: string;
    /** 会话不活跃 TTL（毫秒），默认 30 分钟 */
    sessionTtlMs?: number;
    /** 会话清理扫描间隔（毫秒），默认 5 分钟 */
    cleanupIntervalMs?: number;
}
/**
 * 创建 HTTP MCP 服务器（streamable HTTP 传输）。
 * 路由：
 * - `GET /`         健康检查
 * - `POST /mcp`     JSON-RPC 请求（新会话或已有会话）
 * - `GET /mcp`      SSE 流（需 `MCP-Session-Id` 头）
 * - `DELETE /mcp`   关闭会话（需 `MCP-Session-Id` 头）
 */
export declare function createHttpServer(mcpServer: McpServer, options: HttpServerOptions): Server;
/**
 * 从环境变量读取 HTTP 配置并启动服务：
 * - `MCP_HTTP_HOST` 监听地址（默认 0.0.0.0）
 * - `MCP_HTTP_PORT` 监听端口（默认 3000）
 * - `MCP_HTTP_TOKEN` 可选 Bearer token（局域网共享必须设置）
 */
export declare function startHttpServer(mcpServer: McpServer, options: HttpServerOptions): Promise<Server>;
//# sourceMappingURL=http-server.d.ts.map