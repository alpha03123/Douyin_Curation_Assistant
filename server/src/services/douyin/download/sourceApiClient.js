import {
  ensureDouyinAuth,
  generateWebId,
  getSharedDouyinCookieString,
} from "../auth.js";
import { buildApiHeaders } from "../headers.js";
import { generateABogus, spliceUrl } from "../signature.js";

const DOUYIN_URL = "https://www.douyin.com";
const URL_MATCH_REGEX = /https?:\/\/[^\s]+/i;
const SHORT_LINK_HOSTS = new Set([
  "v.douyin.com",
  "xhslink.com",
  "b23.tv",
  "vm.tiktok.com",
  "vt.tiktok.com",
]);

function stripTrailingUrlPunctuation(value = "") {
  return String(value || "").replace(/[)\]}>,，。！？、；："'`]+$/u, "");
}

export function extractFirstUrlFromText(value = "") {
  const safeValue = String(value || "").trim();
  if (!safeValue) {
    return "";
  }

  const matched = safeValue.match(URL_MATCH_REGEX);
  if (!matched) {
    return "";
  }

  return stripTrailingUrlPunctuation(matched[0]);
}

function createHttpError(message, statusCode = 500, code = null, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

async function resolveShortUrl(url) {
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
  });
  return String(response.url || url);
}

function buildDefaultParams({ auth, referer, webid }) {
  return {
    device_platform: "webapp",
    aid: "6383",
    channel: "channel_pc_web",
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
}

async function requestDouyinJson({ path, params, referer, cookieString }) {
  const auth = ensureDouyinAuth(cookieString || getSharedDouyinCookieString());
  const webid = await generateWebId(auth, referer);
  const nextParams = {
    ...buildDefaultParams({ auth, referer, webid }),
    ...params,
  };
  nextParams.a_bogus = generateABogus(spliceUrl(nextParams), "");

  const requestUrl = `${DOUYIN_URL}${path}?${spliceUrl(nextParams)}`;
  const response = await fetch(requestUrl, {
    method: "GET",
    headers: buildApiHeaders(referer, auth.cookieString),
  });

  if (!response.ok) {
    throw createHttpError(
      `Douyin request failed with status ${response.status}.`,
      response.status,
      "DOUYIN_DOWNLOAD_HTTP_ERROR",
      {
        requestUrl,
      }
    );
  }

  const payload = await response.json();
  if (payload?.status_code && payload.status_code !== 0) {
    throw createHttpError(
      payload?.status_msg || "Douyin request returned an unexpected status.",
      502,
      "DOUYIN_DOWNLOAD_STATUS_ERROR",
      payload
    );
  }

  return payload;
}

export async function resolveUrl(url) {
  const extractedUrl = extractFirstUrlFromText(url);
  const normalizedUrl = extractedUrl || String(url || "").trim();
  try {
    const parsed = new URL(normalizedUrl);
    if (SHORT_LINK_HOSTS.has(parsed.host.toLowerCase())) {
      return resolveShortUrl(normalizedUrl);
    }
  } catch {
    return normalizedUrl;
  }

  return normalizedUrl;
}

export async function getMixDetail(mixId, referer, cookieString = "") {
  const payload = await requestDouyinJson({
    path: "/aweme/v1/web/mix/detail/",
    params: {
      mix_id: String(mixId),
    },
    referer,
    cookieString,
  });

  return payload.mix_info || payload.mix_detail || payload;
}

export async function getMixAwemePage(mixId, cursor = 0, count = 20, referer, cookieString = "") {
  const payload = await requestDouyinJson({
    path: "/aweme/v1/web/mix/aweme/",
    params: {
      mix_id: String(mixId),
      cursor: String(cursor),
      count: String(count),
    },
    referer,
    cookieString,
  });

  return {
    items: Array.isArray(payload.aweme_list) ? payload.aweme_list : [],
    hasMore: payload.has_more === 1,
    cursor: Number(payload.cursor || payload.max_cursor || 0),
    payload,
  };
}

export async function getMusicDetail(musicId, referer, cookieString = "") {
  const payload = await requestDouyinJson({
    path: "/aweme/v1/web/music/detail/",
    params: {
      music_id: String(musicId),
    },
    referer,
    cookieString,
  });

  return payload.music_info || payload.music_detail || payload;
}

export async function getMusicAwemePage(
  musicId,
  cursor = 0,
  count = 20,
  referer,
  cookieString = ""
) {
  const payload = await requestDouyinJson({
    path: "/aweme/v1/web/music/aweme/",
    params: {
      music_id: String(musicId),
      cursor: String(cursor),
      count: String(count),
    },
    referer,
    cookieString,
  });

  return {
    items: Array.isArray(payload.aweme_list) ? payload.aweme_list : [],
    hasMore: payload.has_more === 1,
    cursor: Number(payload.cursor || payload.max_cursor || 0),
    payload,
  };
}

export { createHttpError };
