import crypto from "node:crypto";
import {
  ensureDouyinAuth,
  generateWebId,
} from "./auth.js";
import { searchGeneralWorkPageInBrowser } from "./browserSearchService.js";
import { buildApiHeaders } from "./headers.js";
import { searchGeneralWorkPageViaLegacyPython } from "./legacyKeywordSearchService.js";
import { resolvePreferredDouyinCookieString } from "./sessionCoordinatorService.js";
import { generateABogus, spliceUrl } from "./signature.js";

const DOUYIN_URL = "https://www.douyin.com";
const SEARCH_API = "/aweme/v1/web/general/search/single/";
export const KEYWORD_SEARCH_STRATEGIES = {
  FAST: "fast",
  SAFE: "safe",
  AUTO: "auto",
};

function createHttpError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function createVerifyCheckError(payload, mode = "api") {
  const error = new Error(
    mode === "browser"
      ? "Douyin search hit a verification wall even in browser mode. Run `npm run prepare:browser --workspace server`, complete the verification step in the opened browser, then retry."
      : "Douyin search hit a verification wall. The backend will try browser fallback automatically."
  );
  error.statusCode = 409;
  error.code = "DOUYIN_VERIFY_CHECK";
  error.details = {
    mode,
    searchNilInfo: payload?.search_nil_info || null,
    suggestedAction: "npm run prepare:browser --workspace server",
  };
  return error;
}

function normalizeSearchStrategy(value = "") {
  const safeValue = String(value || "").trim().toLowerCase();
  if (safeValue === KEYWORD_SEARCH_STRATEGIES.FAST) {
    return KEYWORD_SEARCH_STRATEGIES.FAST;
  }

  if (safeValue === KEYWORD_SEARCH_STRATEGIES.SAFE) {
    return KEYWORD_SEARCH_STRATEGIES.SAFE;
  }

  return KEYWORD_SEARCH_STRATEGIES.AUTO;
}

function createSearchReferer(query) {
  return `https://www.douyin.com/search/${encodeURIComponent(
    query
  )}?aid=${crypto.randomUUID()}&type=general`;
}

function buildSearchParams({
  auth,
  query,
  offset,
  count,
  sortType,
  publishTime,
  filterDuration,
  searchRange,
  contentType,
  webid,
}) {
  const params = {
    device_platform: "webapp",
    aid: "6383",
    channel: "channel_pc_web",
    search_channel: "aweme_general",
    enable_history: "1",
    filter_selected: JSON.stringify({
      sort_type: sortType,
      publish_time: publishTime,
      filter_duration: filterDuration,
      search_range: searchRange,
      content_type: contentType,
    }),
    keyword: query,
    search_source: "tab_search",
    query_correct_type: "1",
    is_filter_search: "1",
    from_group_id: "",
    offset,
    count,
    need_filter_settings: offset === "0" ? "1" : "0",
    list_type: "single",
    update_version_code: "170400",
    pc_client_type: "1",
    version_code: "190600",
    version_name: "19.6.0",
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
    round_trip_time: "50",
    webid,
    msToken: auth.msToken,
  };

  params.a_bogus = generateABogus(spliceUrl(params), "");
  return params;
}

async function createSearchRequest(auth, options) {
  const referer = createSearchReferer(options.query);
  const webid = await generateWebId(auth, referer);
  const params = buildSearchParams({
    auth,
    query: options.query,
    offset: options.offset,
    count: options.count,
    sortType: options.sortType,
    publishTime: options.publishTime,
    filterDuration: options.filterDuration,
    searchRange: options.searchRange,
    contentType: options.contentType,
    webid,
  });
  const requestUrl = `${DOUYIN_URL}${SEARCH_API}?${spliceUrl(params)}`;
  return {
    referer,
    params,
    requestUrl,
  };
}

async function searchGeneralWorkPageViaApi(auth, options) {
  const { referer, params, requestUrl } = await createSearchRequest(auth, options);
  const response = await fetch(requestUrl, {
    method: "GET",
    headers: buildApiHeaders(referer, auth.cookieString),
  });

  if (!response.ok) {
    throw createHttpError(
      `Douyin search request failed with status ${response.status}`,
      response.status
    );
  }

  const payload = await response.json();
  if (payload?.status_code && payload.status_code !== 0) {
    throw createHttpError(
      payload?.status_msg || "Douyin search returned an unexpected status",
      502
    );
  }

  return { payload, referer, params };
}

async function searchGeneralWorkPageViaSafeBrowser(auth, options) {
  const { referer, params } = await createSearchRequest(auth, options);

  return searchGeneralWorkPageInBrowser({
    auth,
    referer,
    params,
    verifyCheckErrorFactory: (browserPayload) =>
      createVerifyCheckError(browserPayload, "browser"),
    httpErrorFactory: createHttpError,
  });
}

async function searchGeneralWorkPageViaLegacy(auth, options) {
  return searchGeneralWorkPageViaLegacyPython({
    cookieString: auth.cookieString,
    query: options.query,
    offset: options.offset,
    count: options.count,
    sortType: options.sortType,
    publishTime: options.publishTime,
    filterDuration: options.filterDuration,
    searchRange: options.searchRange,
    contentType: options.contentType,
  });
}

async function searchGeneralWorkPage(auth, options) {
  const searchStrategy = normalizeSearchStrategy(options.searchStrategy);

  if (searchStrategy === KEYWORD_SEARCH_STRATEGIES.SAFE) {
    return searchGeneralWorkPageViaSafeBrowser(auth, options);
  }

  const { payload, referer, params } = await searchGeneralWorkPageViaApi(
    auth,
    options
  );

  if (payload?.search_nil_info?.search_nil_type === "verify_check") {
    if (searchStrategy === KEYWORD_SEARCH_STRATEGIES.FAST) {
      throw createVerifyCheckError(payload, "api");
    }

    try {
      const legacyPayload = await searchGeneralWorkPageViaLegacy(auth, options);

      if (legacyPayload?.status_code === 0) {
        const legacyVerifyType = legacyPayload?.search_nil_info?.search_nil_type;
        if (legacyVerifyType !== "verify_check") {
          return legacyPayload;
        }
      }
    } catch {
      // Legacy Python search is a stability-oriented fallback. If it fails,
      // continue to the browser fallback below instead of masking the result.
    }

    try {
      return await searchGeneralWorkPageInBrowser({
        auth,
        referer,
        params,
        verifyCheckErrorFactory: (browserPayload) =>
          createVerifyCheckError(browserPayload, "browser"),
        httpErrorFactory: createHttpError,
      });
    } catch (error) {
      if (error.code === "DOUYIN_VERIFY_CHECK") {
        throw error;
      }

      throw createHttpError(
        `Douyin search browser fallback failed: ${error.message}`,
        error.statusCode || 500
      );
    }
  }

  return payload;
}

export async function searchGeneralWorkBatch({
  cookieString = "",
  query,
  offset = 0,
  count = 25,
  sortType = "0",
  publishTime = "0",
  filterDuration = "",
  searchRange = "0",
  contentType = "0",
  searchStrategy = KEYWORD_SEARCH_STRATEGIES.AUTO,
}) {
  if (!query) {
    throw createHttpError("Query is required for discovery search.", 400);
  }

  const resolvedCookieString =
    cookieString ||
    (
      await resolvePreferredDouyinCookieString({
        targetUrl: createSearchReferer(query),
        synchronizeProfiles: false,
      })
    ).cookieString;
  const auth = ensureDouyinAuth(resolvedCookieString);
  const safeCount = Math.max(1, Math.min(Number(count) || 25, 25));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const payload = await searchGeneralWorkPage(auth, {
    query,
    offset: String(safeOffset),
    count: String(safeCount),
    sortType: String(sortType),
    publishTime: String(publishTime),
    filterDuration: String(filterDuration ?? ""),
    searchRange: String(searchRange ?? "0"),
    contentType: String(contentType ?? "0"),
    searchStrategy: normalizeSearchStrategy(searchStrategy),
  });

  const items = Array.isArray(payload?.data) ? payload.data : [];
  return {
    items,
    hasMore: payload?.has_more === 1,
    nextOffset: safeOffset + items.length,
    payload,
  };
}

export async function searchSomeGeneralWork({
  cookieString = "",
  query,
  requireNum = 20,
  sortType = "0",
  publishTime = "0",
  filterDuration = "",
  searchRange = "0",
  contentType = "0",
  searchStrategy = KEYWORD_SEARCH_STRATEGIES.AUTO,
}) {
  if (!query) {
    throw createHttpError("Query is required for discovery search.", 400);
  }

  const resolvedCookieString =
    cookieString ||
    (
      await resolvePreferredDouyinCookieString({
        targetUrl: createSearchReferer(query),
        synchronizeProfiles: false,
      })
    ).cookieString;
  const auth = ensureDouyinAuth(resolvedCookieString);
  const targetCount = Math.max(1, Math.min(Number(requireNum) || 20, 100));
  const results = [];
  let offset = 0;

  while (results.length < targetCount) {
    const batch = await searchGeneralWorkBatch({
      cookieString: auth.cookieString,
      query,
      offset,
      count: 25,
      sortType,
      publishTime,
      filterDuration,
      searchRange,
      contentType,
      searchStrategy: normalizeSearchStrategy(searchStrategy),
    });
    const currentItems = batch.items;
    results.push(...currentItems);

    if (!batch.hasMore || currentItems.length === 0) {
      break;
    }

    offset = batch.nextOffset;
  }

  return results.slice(0, targetCount);
}
