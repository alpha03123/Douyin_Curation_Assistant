import {
  ensureDouyinAuth,
  generateWebId,
  getSharedDouyinCookieString,
} from "../auth.js";
import { buildApiHeaders } from "../headers.js";
import { generateABogus, spliceUrl } from "../signature.js";

const DOUYIN_URL = "https://www.douyin.com";
const AWEME_DETAIL_API = "/aweme/v1/web/aweme/detail/";
const DETAIL_AID_CANDIDATES = ["6383", "1128"];

export function createHttpError(message, statusCode = 500, code = null, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

export function buildCanonicalWorkUrl(work = {}) {
  if (work?.awemeId) {
    if (work.workType === "image") {
      return `https://www.douyin.com/note/${work.awemeId}`;
    }

    return `https://www.douyin.com/video/${work.awemeId}`;
  }

  return String(work?.workUrl || "").trim();
}

function buildDetailParams({ auth, awemeId, referer, aid, webid }) {
  const params = {
    device_platform: "webapp",
    aid,
    channel: "channel_pc_web",
    aweme_id: awemeId,
    pc_client_type: "1",
    update_version_code: "170400",
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
    cpu_core_num: "12",
    device_memory: "8",
    platform: "PC",
    downlink: "10",
    effective_type: "4g",
    round_trip_time: "50",
    webid,
    msToken: auth.msToken,
    verifyFp: auth.verifyFp,
    fp: auth.verifyFp,
  };

  params.a_bogus = generateABogus(spliceUrl(params), "");
  return params;
}

async function fetchAwemeDetailByAid({ auth, awemeId, referer, aid }) {
  const webid = await generateWebId(auth, referer);
  const params = buildDetailParams({
    auth,
    awemeId,
    referer,
    aid,
    webid,
  });
  const requestUrl = `${DOUYIN_URL}${AWEME_DETAIL_API}?${spliceUrl(params)}`;
  const response = await fetch(requestUrl, {
    method: "GET",
    headers: buildApiHeaders(referer, auth.cookieString),
  });

  if (!response.ok) {
    throw createHttpError(
      `Douyin detail request failed with status ${response.status}.`,
      response.status,
      "DOUYIN_DETAIL_HTTP_ERROR"
    );
  }

  const payload = await response.json();
  if (payload?.status_code && payload.status_code !== 0) {
    throw createHttpError(
      payload?.status_msg || "Douyin detail returned an unexpected status.",
      502,
      "DOUYIN_DETAIL_STATUS_ERROR",
      payload
    );
  }

  return payload;
}

export async function getAwemeDetail(awemeId, workUrl = "", cookieString = "") {
  if (!awemeId) {
    throw createHttpError("Aweme ID is required for detail resolving.", 400);
  }

  const referer =
    String(workUrl || "").trim() || `https://www.douyin.com/video/${awemeId}`;
  const auth = ensureDouyinAuth(cookieString || getSharedDouyinCookieString());
  let lastPayload = null;

  for (const aid of DETAIL_AID_CANDIDATES) {
    try {
      const payload = await fetchAwemeDetailByAid({
        auth,
        awemeId: String(awemeId),
        referer,
        aid,
      });
      lastPayload = payload;

      if (payload?.aweme_detail) {
        return payload.aweme_detail;
      }
    } catch (error) {
      lastPayload = error.details || lastPayload;
      continue;
    }
  }

  throw createHttpError(
    "Unable to resolve aweme detail from Douyin.",
    502,
    "DOUYIN_DETAIL_NOT_FOUND",
    lastPayload
  );
}

export async function resolveWorkDownloadDetail(work) {
  if (!work) {
    throw createHttpError("Work is required for download resolving.", 400);
  }

  const rawDetail = work?.rawJson?.aweme_info;
  const workUrl = buildCanonicalWorkUrl(work);
  const hasUsableRawMediaData =
    Boolean(rawDetail?.video?.play_addr || rawDetail?.video?.download_addr) ||
    Boolean(rawDetail?.image_post_info?.images?.length) ||
    Boolean(rawDetail?.images?.length) ||
    Boolean(rawDetail?.music?.play_url || rawDetail?.music?.play_url_lowbr);

  if (rawDetail?.aweme_id && hasUsableRawMediaData) {
    return rawDetail;
  }

  try {
    return await getAwemeDetail(work.awemeId, workUrl);
  } catch (error) {
    if (rawDetail?.aweme_id) {
      return rawDetail;
    }

    throw error;
  }
}
