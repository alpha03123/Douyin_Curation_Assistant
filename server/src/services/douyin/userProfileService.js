import {
  ensureDouyinAuth,
  generateWebId,
  getSharedDouyinCookieString,
} from "./auth.js";
import { buildApiHeaders } from "./headers.js";
import { generateABogus, spliceUrl } from "./signature.js";

const DOUYIN_URL = "https://www.douyin.com";
const USER_PROFILE_API = "/aweme/v1/web/user/profile/other/";

function createHttpError(message, statusCode = 500, code = null, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function extractSecUidFromUserUrl(userUrl = "") {
  const safeUrl = String(userUrl || "").trim();
  const matched = safeUrl.match(/\/user\/([^/?#]+)/i);
  return matched?.[1] || "";
}

function buildUserProfileParams({ auth, secUserId, referer, webid }) {
  const params = {
    device_platform: "webapp",
    aid: "6383",
    channel: "channel_pc_web",
    publish_video_strategy_type: "2",
    source: "channel_pc_web",
    sec_user_id: secUserId,
    personal_center_strategy: "1",
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
    round_trip_time: "100",
    webid,
    msToken: auth.msToken,
    verifyFp: auth.verifyFp,
    fp: auth.verifyFp,
  };

  params.a_bogus = generateABogus(spliceUrl(params), referer);
  return params;
}

export async function fetchDouyinUserProfile({
  cookieString = "",
  secUserId = "",
  userUrl = "",
} = {}) {
  const normalizedSecUserId =
    String(secUserId || "").trim() || extractSecUidFromUserUrl(userUrl);
  if (!normalizedSecUserId) {
    throw createHttpError(
      "A sec_user_id or valid userUrl is required for user profile resolving.",
      400,
      "DOUYIN_USER_PROFILE_SEC_UID_REQUIRED"
    );
  }

  const referer =
    String(userUrl || "").trim() || `https://www.douyin.com/user/${normalizedSecUserId}`;
  const auth = ensureDouyinAuth(cookieString || getSharedDouyinCookieString());
  const webid = await generateWebId(auth, referer);
  const params = buildUserProfileParams({
    auth,
    secUserId: normalizedSecUserId,
    referer,
    webid,
  });
  const requestUrl = `${DOUYIN_URL}${USER_PROFILE_API}?${spliceUrl(params)}`;

  const response = await fetch(requestUrl, {
    method: "GET",
    headers: buildApiHeaders(referer, auth.cookieString),
  });

  if (!response.ok) {
    throw createHttpError(
      `Douyin user profile request failed with status ${response.status}.`,
      response.status,
      "DOUYIN_USER_PROFILE_HTTP_ERROR"
    );
  }

  const payload = await response.json();
  if (payload?.status_code && payload.status_code !== 0) {
    throw createHttpError(
      payload?.status_msg || "Douyin user profile returned an unexpected status.",
      502,
      "DOUYIN_USER_PROFILE_STATUS_ERROR",
      payload
    );
  }

  return payload;
}
