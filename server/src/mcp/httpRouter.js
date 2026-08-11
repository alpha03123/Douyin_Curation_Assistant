import { randomUUID } from "node:crypto";
import { Router } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createDouyinMcpServer } from "./server.js";

function sendJsonRpcError(res, statusCode, code, message) {
  res.status(statusCode).json({
    jsonrpc: "2.0",
    error: {
      code,
      message,
    },
    id: null,
  });
}

export function createMcpHttpRouter() {
  const router = Router();
  const sessions = new Map();

  router.all("/", async (req, res) => {
    if (!["POST", "GET", "DELETE"].includes(req.method)) {
      res.set("Allow", "POST, GET, DELETE");
      sendJsonRpcError(res, 405, -32600, "Method not allowed.");
      return;
    }

    try {
      const sessionId = req.get("mcp-session-id");
      let transport = sessionId ? sessions.get(sessionId) : null;

      if (!transport) {
        if (req.method !== "POST" || sessionId || !isInitializeRequest(req.body)) {
          sendJsonRpcError(res, 400, -32000, "No valid MCP session was provided.");
          return;
        }

        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          enableJsonResponse: true,
          onsessioninitialized: (createdSessionId) => {
            sessions.set(createdSessionId, transport);
          },
          onsessionclosed: (closedSessionId) => {
            sessions.delete(closedSessionId);
          },
        });
        await createDouyinMcpServer().connect(transport);
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("[mcp] request failed", error);
      if (!res.headersSent) {
        sendJsonRpcError(res, 500, -32603, "Internal MCP server error.");
      }
    }
  });

  return router;
}
