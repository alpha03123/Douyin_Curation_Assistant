import assert from "node:assert/strict";
import test from "node:test";

process.env.MCP_AUTH_TOKEN = "test-mcp-token";

const { createApp } = await import("../../src/app.js");

async function startApp() {
  const app = createApp();
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

const initializeRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0.0" },
  },
};

test("requires a bearer token for MCP requests", async () => {
  const app = await startApp();
  try {
    const response = await fetch(app.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(initializeRequest),
    });

    assert.equal(response.status, 401);
  } finally {
    await app.close();
  }
});

test("initializes an HTTP MCP session and lists tools", async () => {
  const app = await startApp();
  try {
    const initialized = await fetch(app.url, {
      method: "POST",
      headers: {
        authorization: "Bearer test-mcp-token",
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify(initializeRequest),
    });
    const sessionId = initialized.headers.get("mcp-session-id");

    assert.equal(initialized.status, 200);
    assert.ok(sessionId);

    const tools = await fetch(app.url, {
      method: "POST",
      headers: {
        authorization: "Bearer test-mcp-token",
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-11-25",
        "mcp-session-id": sessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    });
    const payload = await tools.json();

    assert.equal(tools.status, 200);
    assert.deepEqual(
      payload.result.tools.map((tool) => tool.name).sort(),
      [
        "douyin_get_login_status",
        "douyin_get_video_comments",
        "douyin_post_comment",
        "douyin_search_videos",
      ]
    );
  } finally {
    await app.close();
  }
});
