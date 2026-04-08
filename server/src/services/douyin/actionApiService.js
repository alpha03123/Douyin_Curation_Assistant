import crypto from "node:crypto";
import {
  ensureDouyinAuth,
  generateWebId,
  getSharedDouyinCookieString,
} from "./auth.js";
import {
  launchPersistentDouyinContext,
  resolveExecutablePath,
} from "./browserSearchService.js";
import { buildApiHeaders } from "./headers.js";
import { generateABogus, spliceUrl } from "./signature.js";

const DOUYIN_URL = "https://www.douyin.com";
const DIGG_API = "/aweme/v1/web/commit/item/digg/";
const COLLECT_API = "/aweme/v1/web/aweme/collect/";
const COMMENT_PUBLISH_API = "/aweme/v1/web/comment/publish";
const BD_TICKET_GUARD_REE_PUBLIC_KEY =
  "BCXGBBKLS6ybxTSjQJp1aDaSqZ3LWrl/Z/d4M92dirFVXVG4UvV74q55RS9ouv6awvhzlZUJsUrB+br8Rqi5Py0=";

function createHttpError(message, statusCode = 500, code = null, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function buildWorkUrl(work) {
  if (work?.workUrl) {
    return work.workUrl;
  }

  if (work?.awemeId) {
    if (work?.workType === "image") {
      return `https://www.douyin.com/note/${work.awemeId}`;
    }

    return `https://www.douyin.com/video/${work.awemeId}`;
  }

  return "";
}

function buildBaseActionParams({ auth, webid, uifid, extraParams = {} }) {
  const params = {
    device_platform: "webapp",
    aid: "6383",
    channel: "channel_pc_web",
    pc_client_type: "1",
    pc_libra_divert: "Windows",
    update_version_code: "170400",
    support_h265: "0",
    support_dash: "1",
    version_code: "170400",
    version_name: "17.4.0",
    cookie_enabled: "true",
    screen_width: "1707",
    screen_height: "960",
    browser_language: "zh-CN",
    browser_platform: "Win32",
    browser_name: "Firefox",
    browser_version: "117.0",
    browser_online: "true",
    engine_name: "Gecko",
    engine_version: "109.0",
    os_name: "Windows",
    os_version: "10",
    cpu_core_num: "12",
    device_memory: "8",
    platform: "PC",
    downlink: "1.55",
    effective_type: "4g",
    round_trip_time: "150",
    webid,
    msToken: auth.msToken,
    verifyFp: auth.verifyFp,
    fp: auth.verifyFp,
    ...extraParams,
  };

  if (uifid) {
    params.uifid = uifid;
  }

  return params;
}

function buildActionHeaders({ referer, cookieString, uifid }) {
  const headers = {
    ...buildApiHeaders(referer, cookieString),
    "accept-language": "zh-CN",
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    origin: DOUYIN_URL,
    "bd-ticket-guard-ree-public-key": BD_TICKET_GUARD_REE_PUBLIC_KEY,
    "bd-ticket-guard-version": "2",
    "bd-ticket-guard-web-sign-type": "0",
    "bd-ticket-guard-web-version": "2",
    "x-secsdk-csrf-token": "DOWNGRADE",
  };

  if (uifid) {
    headers.uifid = uifid;
  }

  return headers;
}

function buildBrowserRuntimeHeaders({ uifid }) {
  const headers = {
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    "x-secsdk-csrf-token": "DOWNGRADE",
    "bd-ticket-guard-ree-public-key": BD_TICKET_GUARD_REE_PUBLIC_KEY,
    "bd-ticket-guard-version": "2",
    "bd-ticket-guard-web-sign-type": "0",
    "bd-ticket-guard-web-version": "2",
  };

  if (uifid) {
    headers.uifid = uifid;
  }

  return headers;
}

function serializeBrowserCookies(cookies = []) {
  return cookies
    .filter((item) => item?.name && item?.value !== undefined && item?.value !== null)
    .map((item) => `${item.name}=${item.value}`)
    .join("; ");
}

async function createActionContext(cookieString, work) {
  const workUrl = buildWorkUrl(work);
  if (!work?.awemeId || !workUrl) {
    throw createHttpError(
      "The task is missing awemeId or workUrl.",
      400,
      "DOUYIN_ACTION_WORK_MISSING"
    );
  }

  const effectiveCookieString = cookieString || getSharedDouyinCookieString();

  if (!effectiveCookieString) {
    throw createHttpError(
      "DY_COOKIES is missing. Add it to Douyin_Curation_Assistant/.env first.",
      500,
      "DY_COOKIES_MISSING"
    );
  }

  const auth = ensureDouyinAuth(effectiveCookieString);
  const uifid = auth.cookie.UIFID || auth.cookie.uifid || "";

  return {
    auth,
    workUrl,
    awemeId: String(work.awemeId),
    uifid,
    cookieSource: cookieString ? "argument" : "shared-env",
  };
}

async function postFormAction({
  auth,
  workUrl,
  uifid,
  cookieSource,
  apiPath,
  bodyData,
  extraQuery = {},
}) {
  const webid = await generateWebId(auth, workUrl);
  const bodyString = spliceUrl(bodyData);
  const params = buildBaseActionParams({
    auth,
    webid,
    uifid,
    extraParams: extraQuery,
  });
  params.a_bogus = generateABogus(spliceUrl(params), bodyString);

  const requestUrl = `${DOUYIN_URL}${apiPath}?${spliceUrl(params)}`;
  const response = await fetch(requestUrl, {
    method: "POST",
    headers: buildActionHeaders({
      referer: workUrl,
      cookieString: auth.cookieString,
      uifid,
    }),
    body: bodyString,
  });

  const rawText = await response.text();
  let payload = null;
  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw createHttpError(
      `Douyin action request failed with status ${response.status}.`,
      response.status,
      "DOUYIN_ACTION_HTTP_ERROR",
      {
        apiPath,
        requestUrl,
        rawText: rawText.slice(0, 600),
        responsePayload: payload,
      }
    );
  }

  if (!payload || typeof payload !== "object") {
    throw createHttpError(
      "Douyin action did not return a valid JSON payload.",
      502,
      "DOUYIN_ACTION_INVALID_RESPONSE",
      {
        apiPath,
        requestUrl,
        rawText: rawText.slice(0, 600),
      }
    );
  }

  if (payload?.status_code && payload.status_code !== 0) {
    const isLoginRequired =
      payload?.status_code === 8 ||
      String(payload?.status_msg || "").includes("用户未登录");

    throw createHttpError(
      payload?.status_msg || "Douyin action returned an unexpected status.",
      502,
      isLoginRequired ? "DY_COOKIES_INVALID" : "DOUYIN_ACTION_STATUS_ERROR",
      {
        apiPath,
        requestUrl,
        rawText: rawText.slice(0, 600),
        responsePayload: payload,
      }
    );
  }

  return {
    method: "direct-api",
    cookieSource,
    apiPath,
    requestUrl,
    body: bodyData,
    response: payload,
  };
}

async function likeAweme(cookieString, work) {
  const context = await createActionContext(cookieString, work);
  return postFormAction({
    ...context,
    apiPath: DIGG_API,
    bodyData: {
      aweme_id: context.awemeId,
      item_type: "0",
      type: "1",
    },
  });
}

async function undoLikeAweme(cookieString, work) {
  const context = await createActionContext(cookieString, work);
  return postFormAction({
    ...context,
    apiPath: DIGG_API,
    bodyData: {
      aweme_id: context.awemeId,
      item_type: "0",
      type: "0",
    },
  });
}

async function collectAweme(cookieString, work) {
  const context = await createActionContext(cookieString, work);
  return postFormAction({
    ...context,
    apiPath: COLLECT_API,
    bodyData: {
      action: "1",
      aweme_id: context.awemeId,
      aweme_type: "0",
    },
  });
}

async function uncollectAweme(cookieString, work) {
  const context = await createActionContext(cookieString, work);
  return postFormAction({
    ...context,
    apiPath: COLLECT_API,
    bodyData: {
      action: "0",
      aweme_id: context.awemeId,
      aweme_type: "0",
    },
  });
}

function buildCommentBody({ awemeId, draftText }) {
  const safeText = String(draftText || "").trim();
  if (!safeText) {
    throw createHttpError(
      "Comment task is missing draft text.",
      400,
      "COMMENT_DRAFT_REQUIRED"
    );
  }

  return {
    aweme_id: awemeId,
    comment_send_celltime: String(2400 + crypto.randomInt(800, 2200)),
    comment_video_celltime: String(500 + crypto.randomInt(200, 1200)),
    one_level_comment_rank: "-1",
    paste_edit_method: "non_paste",
    text: safeText,
    text_extra: "[]",
  };
}

async function publishComment(cookieString, work, draftText) {
  const context = await createActionContext(cookieString, work);
  return postFormAction({
    ...context,
    apiPath: COMMENT_PUBLISH_API,
    extraQuery: {
      app_name: "aweme",
      enter_from: "video_detail",
      previous_page: "video_detail",
    },
    bodyData: buildCommentBody({
      awemeId: context.awemeId,
      draftText,
    }),
  });
}

export async function executeDouyinApiAction(task, work, cookieString) {
  if (task.actionType === "like") {
    return likeAweme(cookieString, work);
  }

  if (task.actionType === "collect") {
    return collectAweme(cookieString, work);
  }

  if (task.actionType === "comment") {
    return publishComment(cookieString, work, task.draftText || "");
  }

  throw createHttpError(
    `Unsupported action type: ${task.actionType}`,
    400,
    "ACTION_TYPE_UNSUPPORTED"
  );
}

export async function rollbackDouyinApiAction(task, work, cookieString) {
  if (task.actionType === "like") {
    return undoLikeAweme(cookieString, work);
  }

  if (task.actionType === "collect") {
    return uncollectAweme(cookieString, work);
  }

  return null;
}

export async function executeDouyinBrowserApiAction(task, work, options = {}) {
  const workUrl = buildWorkUrl(work);
  if (!work?.awemeId || !workUrl) {
    throw createHttpError(
      "The task is missing awemeId or workUrl.",
      400,
      "DOUYIN_ACTION_WORK_MISSING"
    );
  }

  const executablePath = await resolveExecutablePath();
  if (!executablePath) {
    throw createHttpError(
      "No Edge or Chrome executable was found on this machine.",
      500,
      "BROWSER_EXECUTABLE_MISSING"
    );
  }

  const headless =
    options.headless === undefined ? true : Boolean(options.headless);
  const context = await launchPersistentDouyinContext({
    executablePath,
    headless,
  });

  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(workUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(1800);

    const browserCookies = await context.cookies("https://www.douyin.com");
    const auth = ensureDouyinAuth(serializeBrowserCookies(browserCookies));
    const uifid =
      auth.cookie.UIFID ||
      auth.cookie.uifid ||
      auth.cookie.UIFID_TEMP ||
      "";
    const webid = await generateWebId(auth, workUrl);

    let apiPath = "";
    let extraQuery = {};
    let bodyData = {};

    if (task.actionType === "like") {
      apiPath = DIGG_API;
      bodyData = {
        aweme_id: String(work.awemeId),
        item_type: "0",
        type: "1",
      };
    } else if (task.actionType === "collect") {
      apiPath = COLLECT_API;
      bodyData = {
        action: "1",
        aweme_id: String(work.awemeId),
        aweme_type: "0",
      };
    } else if (task.actionType === "comment") {
      apiPath = COMMENT_PUBLISH_API;
      extraQuery = {
        app_name: "aweme",
        enter_from: "video_detail",
        previous_page: "video_detail",
      };
      bodyData = buildCommentBody({
        awemeId: String(work.awemeId),
        draftText: task.draftText || "",
      });
    } else {
      throw createHttpError(
        `Unsupported action type: ${task.actionType}`,
        400,
        "ACTION_TYPE_UNSUPPORTED"
      );
    }

    const params = buildBaseActionParams({
      auth,
      webid,
      uifid,
      extraParams: extraQuery,
    });
    const bodyString = spliceUrl(bodyData);
    params.a_bogus = generateABogus(spliceUrl(params), bodyString);
    const requestUrl = `${DOUYIN_URL}${apiPath}?${spliceUrl(params)}`;

    const browserResponse = await page.evaluate(
      async ({ url, body, headers }) => {
        const response = await fetch(url, {
          method: "POST",
          credentials: "include",
          headers,
          body,
        });
        const text = await response.text();
        return {
          status: response.status,
          text,
        };
      },
      {
        url: requestUrl,
        body: bodyString,
        headers: buildBrowserRuntimeHeaders({ uifid }),
      }
    );

    const rawText = browserResponse.text || "";
    let payload = null;
    try {
      payload = rawText ? JSON.parse(rawText) : null;
    } catch {
      payload = null;
    }

    if (browserResponse.status !== 200) {
      throw createHttpError(
        `Douyin browser-context action failed with status ${browserResponse.status}.`,
        browserResponse.status,
        "DOUYIN_BROWSER_ACTION_HTTP_ERROR",
        {
          apiPath,
          requestUrl,
          rawText: rawText.slice(0, 600),
          responsePayload: payload,
        }
      );
    }

    if (!payload || typeof payload !== "object") {
      throw createHttpError(
        "Douyin browser-context action did not return a valid JSON payload.",
        502,
        "DOUYIN_BROWSER_ACTION_INVALID_RESPONSE",
        {
          apiPath,
          requestUrl,
          rawText: rawText.slice(0, 600),
        }
      );
    }

    if (payload?.status_code && payload.status_code !== 0) {
      throw createHttpError(
        payload?.status_msg || "Douyin browser-context action returned an unexpected status.",
        502,
        "DOUYIN_BROWSER_ACTION_STATUS_ERROR",
        {
          apiPath,
          requestUrl,
          rawText: rawText.slice(0, 600),
          responsePayload: payload,
        }
      );
    }

    return {
      method: "browser-context-api",
      apiPath,
      requestUrl,
      body: bodyData,
      response: payload,
    };
  } finally {
    await context.close().catch(() => {});
  }
}
