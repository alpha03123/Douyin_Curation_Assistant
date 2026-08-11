import assert from "node:assert/strict";
import test from "node:test";
import { createDouyinMcpServer } from "../../src/mcp/server.js";

test("registers only the required Douyin MCP tools", () => {
  const server = createDouyinMcpServer();
  const toolNames = Object.keys(server._registeredTools).sort();

  assert.deepEqual(toolNames, [
    "douyin_get_login_status",
    "douyin_get_video_comments",
    "douyin_post_comment",
    "douyin_search_videos",
  ]);
});
