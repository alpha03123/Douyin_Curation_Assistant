import { Work } from "../models/Work.js";
import {
  buildWorkUpsertOperation,
  mapSearchItemToWorkDocument,
} from "../services/douyin/workMapper.js";
import { fetchWorkComments } from "../services/douyin/commentService.js";
import { executeBrowserLabTask } from "../services/douyin/browserLabActionService.js";
import { searchGeneralWorkBatch } from "../services/douyin/searchService.js";
import { getBrowserSessionStatus } from "../services/browserSessionService.js";

function createHttpError(message, statusCode = 500, code = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function createWorkUrl(awemeId) {
  return `https://www.douyin.com/video/${awemeId}`;
}

function summarizeVideo(work) {
  return {
    aweme_id: String(work.awemeId || ""),
    video_url: work.workUrl || "",
    title: work.title || "",
    description: work.desc || "",
    author_name: work.authorName || "",
    author_url: work.userUrl || "",
    like_count: Number(work.diggCount || 0),
    comment_count: Number(work.commentCount || 0),
    collect_count: Number(work.collectCount || 0),
    share_count: Number(work.shareCount || 0),
    published_at: work.publishAt || null,
  };
}

function summarizeComment(comment) {
  return {
    comment_id: String(comment.commentId || ""),
    aweme_id: String(comment.awemeId || ""),
    text: comment.text || "",
    like_count: Number(comment.diggCount || 0),
    reply_count: Number(comment.replyCount || 0),
    created_at: comment.commentCreatedAt || null,
    author: {
      user_id: comment.author?.userId || "",
      unique_id: comment.author?.uniqueId || "",
      nickname: comment.author?.nickname || "",
    },
  };
}

async function persistSearchItems(items, keyword) {
  const workDocuments = items
    .map((item) => mapSearchItemToWorkDocument(item, keyword))
    .filter(Boolean);

  if (workDocuments.length === 0) {
    return [];
  }

  await Work.bulkWrite(workDocuments.map(buildWorkUpsertOperation), {
    ordered: false,
  });

  const persistedWorks = await Work.find({
    awemeId: { $in: workDocuments.map((work) => work.awemeId) },
  });
  const workByAwemeId = new Map(
    persistedWorks.map((work) => [String(work.awemeId), work])
  );

  return workDocuments
    .map((work) => workByAwemeId.get(String(work.awemeId)))
    .filter(Boolean);
}

async function findOrCreateWork(awemeId) {
  const existingWork = await Work.findOne({ awemeId });
  if (existingWork) {
    return existingWork;
  }

  return Work.create({
    awemeId,
    workUrl: createWorkUrl(awemeId),
    discoverySource: "mcp",
    sourceLabel: "mcp",
  });
}

export async function getDouyinLoginStatus() {
  const status = await getBrowserSessionStatus();
  return {
    browser_available: Boolean(status.browserAvailable),
    login_ready: Boolean(status.loginReady),
    verification_required: Boolean(status.verificationRequired),
    preferred_session: status.preferredSource || null,
    status_summary: status.statusSummary || "",
  };
}

export async function searchDouyinVideos({
  keyword,
  offset = 0,
  pageSize = 20,
  sortType = "0",
  publishTime = "0",
  contentType = "0",
  searchStrategy = "auto",
}) {
  const batch = await searchGeneralWorkBatch({
    query: keyword,
    offset,
    count: pageSize,
    sortType,
    publishTime,
    contentType,
    searchStrategy,
  });
  const works = await persistSearchItems(batch.items, keyword);

  return {
    keyword,
    has_more: batch.hasMore,
    next_offset: batch.nextOffset,
    videos: works.map(summarizeVideo),
  };
}

export async function getDouyinVideoComments({ awemeId, limit = 30 }) {
  const comments = await fetchWorkComments({
    awemeId,
    workUrl: createWorkUrl(awemeId),
    limit,
  });

  return {
    aweme_id: awemeId,
    comments: comments.map(summarizeComment),
  };
}

export async function postDouyinVideoComment({
  awemeId,
  content,
  headless = false,
}) {
  const safeContent = String(content || "").trim();
  if (!safeContent) {
    throw createHttpError("Comment content is required.", 400, "COMMENT_REQUIRED");
  }

  const work = await findOrCreateWork(awemeId);
  const execution = await executeBrowserLabTask(
    {
      actionType: "comment",
      draftText: safeContent,
    },
    work,
    {
      headless,
      sessionProfileKeys: ["recommend"],
    }
  );
  const action = execution.actionResult || {};

  if (!action.ok || !action.responseJson?.comment?.cid) {
    throw createHttpError(
      "Douyin did not confirm that the comment was published.",
      502,
      "COMMENT_NOT_CONFIRMED"
    );
  }

  return {
    aweme_id: awemeId,
    comment_id: String(action.responseJson.comment.cid),
    content: safeContent,
    video_url: execution.workUrl || work.workUrl,
    method: execution.method || "browser-lab",
  };
}
