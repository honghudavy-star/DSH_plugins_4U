/**
 * HTTP MCP 传输层（Streamable HTTP）
 *
 * 支持局域网共享 / Docker 部署：
 * - 有状态会话管理（SDK 自动生成 session id，按 TTL 清理防内存泄漏）
 * - 可选 Bearer token 鉴权（MCP_HTTP_TOKEN）
 * - CORS 支持（浏览器客户端）
 * - 健康检查端点（Docker HEALTHCHECK / 连通性验证）
 */
import { createServer, } from "http";
import { randomUUID } from "crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { logger } from "./utils/logger.js";
const MCP_PATH = "/mcp";
/** 请求体上限：允许 ~10MB 图片以 data URI 形式传入（base64 膨胀后约 14MB） */
const MAX_BODY_BYTES = 30 * 1024 * 1024;
/** 会话 30 分钟不活跃则清理 */
const SESSION_TTL_MS = 30 * 60 * 1000;
/** 会话清理扫描间隔 */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
/** 带 HTTP 状态码的错误，用于区分 400/413/500 等客户端可感知的失败 */
class HttpError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}
function setCorsHeaders(res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, MCP-Session-Id, Authorization");
}
function sendJson(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
}
function sendError(res, status, message) {
    sendJson(res, status, { error: message });
}
/** 读取并解析 JSON 请求体（限制大小，防滥用） */
function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on("data", (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new HttpError(`Request body too large (max ${MAX_BODY_BYTES} bytes)`, 413));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => {
            try {
                const raw = Buffer.concat(chunks).toString("utf8");
                resolve(raw ? JSON.parse(raw) : undefined);
            }
            catch (error) {
                reject(new HttpError(`Invalid JSON body: ${error instanceof Error ? error.message : String(error)}`, 400));
            }
        });
        req.on("error", reject);
    });
}
function isAuthorized(req, token) {
    if (!token) {
        return true;
    }
    return req.headers.authorization === `Bearer ${token}`;
}
/**
 * 创建 HTTP MCP 服务器（streamable HTTP 传输）。
 * 路由：
 * - `GET /`         健康检查
 * - `POST /mcp`     JSON-RPC 请求（新会话或已有会话）
 * - `GET /mcp`      SSE 流（需 `MCP-Session-Id` 头）
 * - `DELETE /mcp`   关闭会话（需 `MCP-Session-Id` 头）
 */
export function createHttpServer(mcpServer, options) {
    const token = options.token?.trim() || undefined;
    const sessions = new Map();
    const ttl = options.sessionTtlMs ?? SESSION_TTL_MS;
    const cleanupInterval = options.cleanupIntervalMs ?? CLEANUP_INTERVAL_MS;
    // 定期清理不活跃会话，防止长驻容器内存泄漏
    const cleanupTimer = setInterval(() => {
        const now = Date.now();
        for (const [id, entry] of sessions) {
            if (now - entry.lastActive > ttl) {
                sessions.delete(id);
                entry.transport.close().catch(() => undefined);
                logger.info("HTTP session expired", { sessionId: id });
            }
        }
    }, cleanupInterval);
    cleanupTimer.unref();
    return createServer((req, res) => {
        handleHttpRequest(mcpServer, sessions, token, ttl, options.version, req, res).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            logger.error("HTTP request failed", { error: message });
            if (!res.headersSent) {
                if (error instanceof HttpError) {
                    sendError(res, error.status, error.message);
                }
                else {
                    sendError(res, 500, "Internal server error");
                }
            }
            else {
                res.end();
            }
        });
    });
}
async function handleHttpRequest(mcpServer, sessions, token, ttl, version, req, res) {
    setCorsHeaders(res);
    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }
    const path = (req.url || "/").split("?")[0];
    // 健康检查端点（公开，供 Docker HEALTHCHECK 使用，无需 token）
    if (req.method === "GET" && path === "/") {
        sendJson(res, 200, {
            name: "luma-mcp",
            version,
            transport: "streamable-http",
            endpoints: [MCP_PATH],
        });
        return;
    }
    if (!isAuthorized(req, token)) {
        res.setHeader("WWW-Authenticate", "Bearer");
        sendError(res, 401, "Unauthorized");
        return;
    }
    if (path !== MCP_PATH) {
        sendError(res, 404, "Not found");
        return;
    }
    const sessionId = req.headers["mcp-session-id"]?.trim();
    if (req.method === "DELETE") {
        if (!sessionId) {
            sendError(res, 404, "Session not found");
            return;
        }
        const entry = sessions.get(sessionId);
        if (!entry) {
            sendError(res, 404, "Session not found");
            return;
        }
        await entry.transport.handleRequest(req, res);
        sessions.delete(sessionId);
        return;
    }
    if (req.method === "GET") {
        const entry = sessionId ? sessions.get(sessionId) : undefined;
        if (!entry) {
            sendError(res, 404, "Session not found");
            return;
        }
        entry.lastActive = Date.now();
        await entry.transport.handleRequest(req, res);
        return;
    }
    if (req.method === "POST") {
        const body = await readJsonBody(req);
        // 已有会话：路由到对应 transport
        if (sessionId) {
            const entry = sessions.get(sessionId);
            if (!entry) {
                sendError(res, 404, "Session not found");
                return;
            }
            entry.lastActive = Date.now();
            await entry.transport.handleRequest(req, res, body);
            return;
        }
        // 新会话：session id 在 initialize 处理时生成，经回调注册
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => {
                sessions.set(id, { transport, lastActive: Date.now() });
            },
        });
        transport.onclose = () => {
            const id = transport.sessionId;
            if (id) {
                sessions.delete(id);
            }
        };
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, body);
        return;
    }
    sendError(res, 405, "Method not allowed");
}
/**
 * 从环境变量读取 HTTP 配置并启动服务：
 * - `MCP_HTTP_HOST` 监听地址（默认 0.0.0.0）
 * - `MCP_HTTP_PORT` 监听端口（默认 3000）
 * - `MCP_HTTP_TOKEN` 可选 Bearer token（局域网共享必须设置）
 */
export async function startHttpServer(mcpServer, options) {
    const host = process.env.MCP_HTTP_HOST?.trim() || "0.0.0.0";
    const rawPort = parseInt(process.env.MCP_HTTP_PORT || "3000", 10);
    const port = Number.isNaN(rawPort) ? 3000 : rawPort;
    const token = options.token || process.env.MCP_HTTP_TOKEN;
    const server = createHttpServer(mcpServer, { version: options.version, token });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => resolve());
    });
    if (token) {
        logger.warn("MCP HTTP auth enabled (MCP_HTTP_TOKEN). All requests require a Bearer token.");
    }
    else {
        logger.warn("MCP HTTP auth is DISABLED. Anyone who can reach this port can use your API keys. Set MCP_HTTP_TOKEN.");
    }
    return server;
}
//# sourceMappingURL=http-server.js.map