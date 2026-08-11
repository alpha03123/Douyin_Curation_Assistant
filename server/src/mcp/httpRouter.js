import crypto from "node:crypto";
import { Router } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { env } from "../config/env.js";
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

function hasValidBearerToken(headerValue) {
  const matched = /^Bearer\s+(.+)$/i.exec(String(headerValue || "").trim());
  if (!matched || !env.mcpAuthToken) {
    return false;
  }

  const expected = Buffer.from(env.mcpAuthToken, "utf8");
  const provided = Buffer.from(matched[1], "utf8");

  return (
    expected.length === provided.length &&
    crypto.timingSafeEqual(expected, provided)
  );
}

export function createMcpHttpRouter() {
  const router = Router();
  const sessions = new Map();

  router.use((req, res, next) => {
    if (!env.mcpAuthToken) {
      sendJsonRpcError(
        res,
        503,
        -32000,
        "MCP_AUTH_TOKEN is required before the MCP endpoint can be used."
      );
      return;
    }

    if (!hasValidBearerToken(req.get("authorization"))) {
      sendJsonRpcError(res, 401, -32000, "Unauthorized MCP request.");
      return;
    }

    next();
  });

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
          sessionIdGenerator: crypto.randomUUID,
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
