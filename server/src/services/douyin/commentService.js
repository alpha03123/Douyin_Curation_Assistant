import {
  ensureDouyinAuth,
  generateWebId,
  getSharedDouyinCookieString,
} from "./auth.js";
import { buildApiHeaders } from "./headers.js";
import { generateABogus, spliceUrl } from "./signature.js";

const DOUYIN_URL = "https://www.douyin.com";
const COMMENT_LIST_API = "/aweme/v1/web/comment/list/";

function createHttpError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function createWorkUrl(awemeId) {
  return `https://www.douyin.com/video/${awemeId}`;
}

function buildCommentParams({ auth, awemeId, cursor, count, referer, webid }) {
  const params = {
    device_platform: "webapp",
    aid: "6383",
    channel: "channel_pc_web",
    aweme_id: awemeId,
    cursor,
    count,
    item_type: "0",
    whale_cut_token: "",
    cut_version: "1",
    rcFT: "",
    update_version_code: "170400",
    pc_client_type: "1",
    version_code: "170400",
    version_name: "17.4.0",
    cookie_enabled: "true",
    screen_width: "1707",
    screen_height: "960",
    browser_language: "zh-CN",
    browser_platform: "Win32",
    browser_name: "Edge",
    browser_version: "125.0.0.0",
    browser_online: "true",
    engine_name: "Blink",
    engine_version: "125.0.0.0",
    os_name: "Windows",
    os_version: "10",
    cpu_core_num: "32",
    device_memory: "8",
    platform: "PC",
    downlink: "10",
    effective_type: "4g",
    round_trip_time: "0",
    webid,
    verifyFp: auth.verifyFp,
    fp: auth.verifyFp,
    msToken: auth.msToken,
  };

  params.a_bogus = generateABogus(spliceUrl(params), referer);
  return params;
}

function normalizeComment(comment) {
  const user = comment?.user || {};

  return {
    commentId: String(comment?.cid || ""),
    awemeId: String(comment?.aweme_id || ""),
    text: String(comment?.text || ""),
    diggCount: Number(comment?.digg_count || 0),
    replyCount: Number(
      comment?.reply_comment_total ?? comment?.reply_comment_count ?? 0
    ),
    commentCreatedAt: comment?.create_time
      ? new Date(Number(comment.create_time) * 1000)
      : null,
    author: {
      userId: String(user?.uid || ""),
      uniqueId: String(user?.unique_id || ""),
      secUid: String(user?.sec_uid || ""),
      nickname: String(user?.nickname || ""),
    },
    rawJson: comment,
  };
}

async function fetchCommentPage({ auth, awemeId, referer, cursor, count }) {
  const webid = await generateWebId(auth, referer);
  const params = buildCommentParams({
    auth,
    awemeId,
    referer,
    cursor,
    count,
    webid,
  });
  const requestUrl = `${DOUYIN_URL}${COMMENT_LIST_API}?${spliceUrl(params)}`;
  const response = await fetch(requestUrl, {
    method: "GET",
    headers: buildApiHeaders(referer, auth.cookieString),
  });

  if (!response.ok) {
    throw createHttpError(
      `Douyin comment request failed with status ${response.status}`,
      response.status
    );
  }

  const payload = await response.json();
  if (payload?.status_code && payload.status_code !== 0) {
    throw createHttpError(
      payload?.status_msg || "Douyin comment request returned an unexpected status",
      502
    );
  }

  return payload;
}

export async function fetchWorkComments({
  cookieString = "",
  awemeId,
  workUrl,
  limit = 30,
}) {
  if (!awemeId) {
    throw createHttpError("Aweme ID is required for comment fetching.", 400);
  }

  const auth = ensureDouyinAuth(cookieString || getSharedDouyinCookieString());
  const referer = workUrl || createWorkUrl(awemeId);
  const safeLimit = Math.max(1, Math.min(Number(limit) || 30, 100));
  const pageSize = Math.min(safeLimit, 20);
  const comments = [];
  let cursor = "0";
  let hasMore = true;

  while (comments.length < safeLimit && hasMore) {
    const payload = await fetchCommentPage({
      auth,
      awemeId,
      referer,
      cursor,
      count: String(pageSize),
    });
    const items = Array.isArray(payload?.comments) ? payload.comments : [];

    comments.push(...items.map(normalizeComment).filter((item) => item.commentId));
    cursor = String(payload?.cursor ?? "0");
    hasMore = payload?.has_more === 1 && items.length > 0;
  }

  return comments.slice(0, safeLimit);
}
