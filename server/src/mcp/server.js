import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getDouyinLoginStatus,
  getDouyinVideoComments,
  postDouyinVideoComment,
  searchDouyinVideos,
} from "./douyinMcpService.js";

function jsonResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function errorResult(error) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            error: error.message || "Unexpected MCP tool error.",
            code: error.code || null,
          },
          null,
          2
        ),
      },
    ],
    isError: true,
  };
}

function registerTool(server, name, config, handler) {
  server.registerTool(name, config, async (args) => {
    try {
      return jsonResult(await handler(args));
    } catch (error) {
      return errorResult(error);
    }
  });
}

export function createDouyinMcpServer() {
  const server = new McpServer({
    name: "douyin-curation-assistant",
    version: "0.1.0",
  });

  registerTool(
    server,
    "douyin_get_login_status",
    {
      title: "Get Douyin Login Status",
      description:
        "Check whether the local browser and its Douyin login session are ready for search, comment retrieval, and publishing.",
    },
    getDouyinLoginStatus
  );

  registerTool(
    server,
    "douyin_search_videos",
    {
      title: "Search Douyin Videos",
      description:
        "Search Douyin videos by keyword. Returns video identifiers that can be passed to comment retrieval and comment publishing.",
      inputSchema: {
        keyword: z.string().trim().min(1).describe("Keyword to search for."),
        offset: z.number().int().min(0).default(0),
        page_size: z.number().int().min(1).max(25).default(20),
        sort_type: z.string().default("0"),
        publish_time: z.string().default("0"),
        content_type: z.string().default("0"),
        search_strategy: z.enum(["auto", "fast", "safe"]).default("auto"),
      },
    },
    (args) =>
      searchDouyinVideos({
        keyword: args.keyword,
        offset: args.offset,
        pageSize: args.page_size,
        sortType: args.sort_type,
        publishTime: args.publish_time,
        contentType: args.content_type,
        searchStrategy: args.search_strategy,
      })
  );

  registerTool(
    server,
    "douyin_get_video_comments",
    {
      title: "Get Douyin Video Comments",
      description:
        "Get top-level comments for a Douyin video identified by aweme_id. Each result includes its reply count.",
      inputSchema: {
        aweme_id: z.string().trim().min(1),
        limit: z.number().int().min(1).max(100).default(30),
      },
    },
    (args) =>
      getDouyinVideoComments({
        awemeId: args.aweme_id,
        limit: args.limit,
      })
  );

  registerTool(
    server,
    "douyin_post_comment",
    {
      title: "Post Douyin Video Comment",
      description:
        "Publish one top-level comment to a Douyin video. The browser action must return Douyin's comment id or the tool reports an error.",
      inputSchema: {
        aweme_id: z.string().trim().min(1),
        content: z.string().trim().min(1),
        headless: z.boolean().default(false),
      },
    },
    (args) =>
      postDouyinVideoComment({
        awemeId: args.aweme_id,
        content: args.content,
        headless: args.headless,
      })
  );

  return server;
}
