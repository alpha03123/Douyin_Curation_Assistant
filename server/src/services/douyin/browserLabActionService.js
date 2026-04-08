import { env } from "../../config/env.js";
import {
  ensureDouyinAuth,
} from "./auth.js";
import {
  BROWSER_PROFILE_DIR,
  RECOMMEND_PROFILE_DIR,
  LAB_PROFILE_DIR,
} from "./browserProfiles.js";
import {
  containsDouyinLoginPrompt,
  hasUsableDouyinSessionCookies,
  launchPersistentDouyinContext,
  resolveExecutablePath,
} from "./browserSearchService.js";
import { resolvePreferredDouyinCookieString } from "./sessionCoordinatorService.js";

const PROFILE_RUNTIME = "runtime";
const PROFILE_RECOMMEND = "recommend";
const PROFILE_LAB = "lab";
const PROFILE_CONFIG_MAP = {
  [PROFILE_RUNTIME]: {
    profileDir: BROWSER_PROFILE_DIR,
    lockOwner: "direct-action-runtime",
    label: "Runtime browser",
  },
  [PROFILE_RECOMMEND]: {
    profileDir: RECOMMEND_PROFILE_DIR,
    lockOwner: "direct-action-recommend",
    label: "Recommend browser",
  },
  [PROFILE_LAB]: {
    profileDir: LAB_PROFILE_DIR,
    lockOwner: "browser-lab",
    label: "Lab browser",
  },
};

function createHttpError(message, statusCode = 500, code = null, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function toBrowserCookies(cookieMap) {
  return Object.entries(cookieMap)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([name, value]) => ({
      name,
      value: String(value),
      domain: ".douyin.com",
      path: "/",
      httpOnly: false,
      secure: true,
      sameSite: "Lax",
    }));
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

function isVerificationPage({ url, title, text }) {
  return (
    String(url || "").includes("captcha") ||
    String(url || "").includes("verify") ||
    String(title || "").includes("验证码") ||
    String(text || "").includes("验证码中间页") ||
    String(text || "").includes("verify_check") ||
    String(text || "").includes("secsdk-captcha")
  );
}

async function detectVisibleLoginOverlay(page) {
  return page.evaluate(() => {
    const candidates = [
      document.querySelector('[id^="login-full-panel-"]'),
      ...document.querySelectorAll("button"),
    ].filter(Boolean);

    for (const candidate of candidates) {
      const text = (candidate.textContent || "").trim();
      const style = window.getComputedStyle(candidate);
      const rect = candidate.getBoundingClientRect();
      const looksLikeLoginPrompt =
        String(candidate.id || "").startsWith("login-full-panel-") ||
        text.includes("立即登录") ||
        text.includes("扫码登录") ||
        text.includes("请先登录") ||
        text.includes("登录后");

      if (
        looksLikeLoginPrompt &&
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      ) {
        return {
          id: candidate.id || "",
          className:
            typeof candidate.className === "string" ? candidate.className : "",
          text: text.slice(0, 120),
        };
      }
    }

    return null;
  });
}

async function inspectLabSessionHealth(context, page) {
  const cookies = await context.cookies("https://www.douyin.com");
  const cookieNames = cookies.map((item) => item.name).filter(Boolean);
  const hasSessionCookie = hasUsableDouyinSessionCookies(cookies);

  if (!page || page.isClosed()) {
    return {
      pageAvailable: false,
      loginReady: false,
      hasSessionCookie,
      verificationRequired: false,
      loginPromptVisible: false,
      currentUrl: "",
      title: "",
      bodyPreview: "",
      cookieNames,
      loginOverlay: null,
    };
  }

  const currentUrl = page.url();
  const title = await page.title().catch(() => "");
  const bodyText = await page.locator("body").innerText({ timeout: 2500 }).catch(() => "");
  const loginOverlay = await detectVisibleLoginOverlay(page).catch(() => null);
  const verificationRequired = isVerificationPage({
    url: currentUrl,
    title,
    text: bodyText,
  });
  const loginPromptVisible =
    Boolean(loginOverlay) ||
    containsDouyinLoginPrompt(title) ||
    containsDouyinLoginPrompt(bodyText);

  return {
    pageAvailable: true,
    loginReady: hasSessionCookie && !loginPromptVisible && !verificationRequired,
    hasSessionCookie,
    verificationRequired,
    loginPromptVisible,
    currentUrl,
    title,
    bodyPreview: String(bodyText || "").slice(0, 500),
    cookieNames,
    loginOverlay,
  };
}

async function maybeSeedPreferredCookies(context, targetUrl = "https://www.douyin.com/") {
  try {
    const existingCookies = await context.cookies("https://www.douyin.com");
    const hasSessionCookie = existingCookies.some((item) =>
      ["sessionid", "sessionid_ss", "sid_tt", "uid_tt", "sid_guard"].includes(
        item.name
      )
    );

    if (hasSessionCookie) {
      return;
    }

    const { cookieString } = await resolvePreferredDouyinCookieString({
      targetUrl,
      synchronizeProfiles: false,
    });
    const auth = ensureDouyinAuth(cookieString);
    await context.addCookies(toBrowserCookies(auth.cookie));
  } catch {
    // noop
  }
}

function resolveSessionProfileSequence(options = {}) {
  const requestedKeys = Array.isArray(options.sessionProfileKeys) && options.sessionProfileKeys.length > 0
    ? options.sessionProfileKeys
    : [PROFILE_LAB];

  const normalizedKeys = [...new Set(
    requestedKeys
      .map((item) => String(item || "").trim().toLowerCase())
      .filter((item) => PROFILE_CONFIG_MAP[item])
  )];

  return normalizedKeys.length > 0
    ? normalizedKeys.map((key) => ({
        profileKey: key,
        ...PROFILE_CONFIG_MAP[key],
      }))
    : [{
        profileKey: PROFILE_LAB,
        ...PROFILE_CONFIG_MAP[PROFILE_LAB],
      }];
}

async function holdVisibleBrowserForRecovery(page, error) {
  if (!page || page.isClosed()) {
    return;
  }

  if (!env.actionBrowserKeepOpenOnFailure) {
    return;
  }

  await page.bringToFront().catch(() => {});
  error.details = {
    ...(error.details || {}),
    browserKeptOpen: true,
    browserFailureHoldMs: env.actionBrowserFailureHoldMs,
  };
  await page.waitForTimeout(env.actionBrowserFailureHoldMs).catch(() => {});
}

function buildDetailActionLocator(page, actionType) {
  const actionIndexMap = {
    like: 0,
    comment: 1,
    collect: 2,
  };
  const actionIndex = actionIndexMap[actionType];
  if (actionIndex === undefined) {
    return null;
  }

  return page
    .locator('[data-e2e="detail-video-info"] > div:nth-child(3) > div > div')
    .nth(actionIndex);
}

async function clickDetailAction(page, actionType) {
  const locator = buildDetailActionLocator(page, actionType);
  if (!locator) {
    throw createHttpError(
      `Unsupported action type "${actionType}" for browser lab execution.`,
      400,
      "ACTION_TYPE_UNSUPPORTED"
    );
  }

  const clickableLocator = locator.locator('[tabindex="0"]').first();
  const hasClickable = (await clickableLocator.count().catch(() => 0)) > 0;
  const targetLocator = hasClickable ? clickableLocator : locator;

  await targetLocator.waitFor({ state: "visible", timeout: 8000 });
  await targetLocator.scrollIntoViewIfNeeded().catch(() => {});
  await targetLocator.click({ timeout: 8000 });
}

function getActionStateSelector(actionType) {
  if (actionType === "like") {
    return '[data-e2e="video-player-digg"]';
  }

  if (actionType === "collect") {
    return '[data-e2e="video-player-collect"]';
  }

  return "";
}

async function readReactionState(page, actionType) {
  const selector = getActionStateSelector(actionType);
  if (!selector) {
    return "";
  }

  return (
    (await page
      .locator(selector)
      .first()
      .getAttribute("data-e2e-state")
      .catch(() => "")) || ""
  );
}

function isReactionApplied(actionType, state) {
  const normalizedState = String(state || "").toLowerCase();
  if (actionType === "like") {
    return normalizedState.includes("digged") && !normalizedState.includes("no-digged");
  }

  if (actionType === "collect") {
    return normalizedState.includes("collect") && !normalizedState.includes("no-collect");
  }

  return false;
}

async function waitForJsonResponse(page, urlPart, triggerFn, timeout = 15000) {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method().toUpperCase() === "POST" &&
      response.url().includes(urlPart),
    { timeout }
  );

  await triggerFn();
  const response = await responsePromise;
  const responseText = await response.text().catch(() => "");
  let responseJson = null;
  try {
    responseJson = responseText ? JSON.parse(responseText) : null;
  } catch {
    responseJson = null;
  }

  return {
    url: response.url(),
    status: response.status(),
    responseText,
    responseJson,
  };
}

function normalizeControlText(value = "") {
  return String(value || "")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

function isFollowStateApplied(stateText = "") {
  const normalized = normalizeControlText(stateText);
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("已关注") ||
    normalized.includes("互相关注") ||
    normalized.includes("following") ||
    normalized.includes("friends")
  );
}

function looksLikeFollowControlText(text = "") {
  const normalized = normalizeControlText(text);
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("关注") ||
    normalized.includes("回关") ||
    normalized.includes("follow")
  );
}

async function resolveFollowControl(page) {
  const selectors = [
    '[data-e2e*="follow"]',
    '[data-e2e*="relation"]',
    '[data-e2e*="user-follow"]',
    '[data-e2e="video-author-card"] button',
    '[data-e2e="video-author-card"] [role="button"]',
    'button:has-text("关注")',
    '[role="button"]:has-text("关注")',
    'button:has-text("回关")',
    '[role="button"]:has-text("回关")',
    'button:has-text("已关注")',
    '[role="button"]:has-text("已关注")',
    'button:has-text("互相关注")',
    '[role="button"]:has-text("互相关注")',
    'button:has-text("Follow")',
    '[role="button"]:has-text("Follow")',
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = Math.min(await locator.count().catch(() => 0), 12);

    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      const visible = await candidate.isVisible().catch(() => false);
      if (!visible) {
        continue;
      }

      const text =
        (await candidate.innerText().catch(() => "")) ||
        (await candidate.textContent().catch(() => "")) ||
        "";

      if (!looksLikeFollowControlText(text)) {
        continue;
      }

      return {
        locator: candidate,
        selector,
        label: String(text || "").trim(),
      };
    }
  }

  return null;
}

async function clickFollowControl(control) {
  const clickableLocator = control.locator.locator('[tabindex="0"]').first();
  const hasClickable = (await clickableLocator.count().catch(() => 0)) > 0;
  const targetLocator = hasClickable ? clickableLocator : control.locator;

  await targetLocator.waitFor({ state: "visible", timeout: 8000 });
  await targetLocator.scrollIntoViewIfNeeded().catch(() => {});
  await targetLocator.click({ timeout: 8000 });
}

async function activateCommentComposer(page) {
  const activationSelectors = [
    '#comment-input-container .lFk180Rt',
    '#comment-input-container .richtext-container',
    '#comment-input-container',
  ];

  for (const selector of activationSelectors) {
    const locator = page.locator(selector).first();
    try {
      await locator.waitFor({ state: "visible", timeout: 3000 });
      await locator.click({ timeout: 5000 });
      await page.waitForTimeout(400);
      return selector;
    } catch {
      continue;
    }
  }

  throw createHttpError(
    "Could not activate the comment composer container.",
    422,
    "DOUYIN_COMMENT_COMPOSER_NOT_FOUND"
  );
}

async function resolveCommentComposer(page) {
  const selectors = [
    '#comment-input-container .public-DraftEditor-content[contenteditable="true"]',
    '#comment-input-container .DraftEditor-editorContainer [contenteditable="true"]',
    '#comment-input-container [contenteditable="true"][role="combobox"]',
    '[contenteditable="true"][data-e2e*="comment"]',
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      await locator.waitFor({ state: "visible", timeout: 2000 });
      return {
        locator,
        strategy: selector,
      };
    } catch {
      continue;
    }
  }

  throw createHttpError(
    "Could not find a visible comment composer in the lab browser.",
    422,
    "DOUYIN_COMMENT_COMPOSER_NOT_FOUND"
  );
}

async function resolveCommentSubmitTrigger(page) {
  const selectors = [
    '#comment-input-container .WFB7wUOX',
    '#comment-input-container .NUzvFSPe',
    '#comment-input-container .zoGB2SZP > span:last-child',
    'button:has-text("发送")',
    '[role="button"]:has-text("发送")',
    'button:has-text("发布")',
    '[role="button"]:has-text("发布")',
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      await locator.waitFor({ state: "visible", timeout: 1500 });
      return {
        locator,
        strategy: selector,
      };
    } catch {
      continue;
    }
  }

  return null;
}

async function fillComposer(locator, text) {
  const tagName = await locator.evaluate((node) => node.tagName.toLowerCase());
  const isContentEditable = await locator.evaluate(
    (node) => node.getAttribute("contenteditable") === "true"
  );

  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.click({ timeout: 8000 });

  if (tagName === "textarea" || tagName === "input") {
    await locator.fill(text, { timeout: 8000 });
    return;
  }

  if (isContentEditable) {
    await locator.evaluate((node) => {
      node.textContent = "";
      node.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
    await locator.pressSequentially(text, { delay: 50 });
    return;
  }

  throw createHttpError(
    "Unsupported comment composer type.",
    422,
    "DOUYIN_COMMENT_COMPOSER_UNSUPPORTED"
  );
}

async function runLike(page) {
  const beforeState = await readReactionState(page, "like");
  if (isReactionApplied("like", beforeState)) {
    return {
      actionType: "like",
      skipped: true,
      reason: "already-liked",
      stateBefore: beforeState,
      stateAfter: beforeState,
      method: "browser-lab",
      ok: true,
      status: 200,
      responseJson: {
        status_code: 0,
        skipped: true,
      },
    };
  }

  const networkResult = await waitForJsonResponse(
    page,
    "/aweme/v1/web/commit/item/digg/",
    async () => {
      await clickDetailAction(page, "like");
    }
  );
  const afterState = await readReactionState(page, "like");
  const ok =
    networkResult.status === 200 &&
    networkResult.responseJson?.status_code === 0 &&
    networkResult.responseJson?.is_digg === 1;

  if (!ok) {
    throw createHttpError(
      "The browser lab like action did not return a successful response.",
      502,
      "DOUYIN_BROWSER_LAB_ACTION_FAILED",
      {
        actionType: "like",
        stateBefore: beforeState,
        stateAfter: afterState,
        ...networkResult,
      }
    );
  }

  return {
    actionType: "like",
    skipped: false,
    stateBefore: beforeState,
    stateAfter: afterState,
    method: "browser-lab",
    ok: true,
    ...networkResult,
  };
}

async function runCollect(page) {
  const beforeState = await readReactionState(page, "collect");
  if (isReactionApplied("collect", beforeState)) {
    return {
      actionType: "collect",
      skipped: true,
      reason: "already-collected",
      stateBefore: beforeState,
      stateAfter: beforeState,
      method: "browser-lab",
      ok: true,
      status: 200,
      responseJson: {
        status_code: 0,
        skipped: true,
      },
    };
  }

  const networkResult = await waitForJsonResponse(
    page,
    "/aweme/v1/web/aweme/collect/",
    async () => {
      await clickDetailAction(page, "collect");
    }
  );
  const afterState = await readReactionState(page, "collect");
  const ok =
    networkResult.status === 200 &&
    networkResult.responseJson?.status_code === 0;

  if (!ok) {
    throw createHttpError(
      "The browser lab collect action did not return a successful response.",
      502,
      "DOUYIN_BROWSER_LAB_ACTION_FAILED",
      {
        actionType: "collect",
        stateBefore: beforeState,
        stateAfter: afterState,
        ...networkResult,
      }
    );
  }

  return {
    actionType: "collect",
    skipped: false,
    stateBefore: beforeState,
    stateAfter: afterState,
    method: "browser-lab",
    ok: true,
    ...networkResult,
  };
}

async function runFollow(page) {
  const followControl = await resolveFollowControl(page);
  if (!followControl) {
    throw createHttpError(
      "Could not find a visible follow control in the lab browser.",
      422,
      "DOUYIN_FOLLOW_CONTROL_NOT_FOUND"
    );
  }

  const stateBefore = followControl.label;
  if (isFollowStateApplied(stateBefore)) {
    return {
      actionType: "follow",
      skipped: true,
      reason: "already-followed",
      strategyBefore: followControl.selector,
      stateBefore,
      stateAfter: stateBefore,
      method: "browser-lab",
      ok: true,
      status: 200,
      responseJson: {
        status_code: 0,
        skipped: true,
      },
    };
  }

  const followUrlParts = [
    "/aweme/v1/web/commit/follow/user/",
    "/aweme/v1/web/commit/user/follow/",
    "/aweme/v1/web/user/follow/",
    "/aweme/v1/web/relation/",
    "/aweme/v1/web/im/user/relation/",
  ];
  const networkResponsePromise = page
    .waitForResponse(
      (response) => {
        const method = response.request().method().toUpperCase();
        if (!["POST", "PUT", "PATCH"].includes(method)) {
          return false;
        }

        return followUrlParts.some((urlPart) => response.url().includes(urlPart));
      },
      { timeout: 12000 }
    )
    .catch(() => null);

  await clickFollowControl(followControl);

  const networkResponse = await networkResponsePromise;
  let networkResult = null;
  if (networkResponse) {
    const responseText = await networkResponse.text().catch(() => "");
    let responseJson = null;
    try {
      responseJson = responseText ? JSON.parse(responseText) : null;
    } catch {
      responseJson = null;
    }

    networkResult = {
      url: networkResponse.url(),
      status: networkResponse.status(),
      responseText,
      responseJson,
    };
  }

  let nextFollowControl = await resolveFollowControl(page);
  let stateAfter = nextFollowControl?.label || "";
  for (let retry = 0; retry < 4 && !isFollowStateApplied(stateAfter); retry += 1) {
    await page.waitForTimeout(500);
    nextFollowControl = await resolveFollowControl(page);
    stateAfter = nextFollowControl?.label || "";
  }

  const okByState = isFollowStateApplied(stateAfter);
  const okByNetwork =
    Boolean(networkResult) &&
    networkResult.status === 200 &&
    (networkResult.responseJson?.status_code === 0 ||
      networkResult.responseJson?.statusCode === 0 ||
      networkResult.responseJson?.status === 0 ||
      networkResult.responseJson?.success === true);

  if (!okByState && !okByNetwork) {
    throw createHttpError(
      "The browser lab follow action did not return a successful response.",
      502,
      "DOUYIN_BROWSER_LAB_ACTION_FAILED",
      {
        actionType: "follow",
        strategyBefore: followControl.selector,
        strategyAfter: nextFollowControl?.selector || "",
        stateBefore,
        stateAfter,
        ...(networkResult || {}),
      }
    );
  }

  return {
    actionType: "follow",
    skipped: false,
    strategyBefore: followControl.selector,
    strategyAfter: nextFollowControl?.selector || "",
    stateBefore,
    stateAfter,
    method: "browser-lab",
    ok: true,
    ...(networkResult || {
      url: "",
      status: 200,
      responseText: "",
      responseJson: {
        status_code: 0,
        inferred: "follow-state-changed",
      },
    }),
  };
}

async function runComment(page, commentText) {
  await clickDetailAction(page, "comment");
  await page.waitForTimeout(800);
  const activationStrategy = await activateCommentComposer(page);
  const composer = await resolveCommentComposer(page);
  await fillComposer(composer.locator, commentText);
  await page.waitForTimeout(700);

  const networkResult = await waitForJsonResponse(
    page,
    "/aweme/v1/web/comment/publish",
    async () => {
      const sendTrigger = await resolveCommentSubmitTrigger(page);

      if (sendTrigger) {
        await sendTrigger.locator.click({ timeout: 5000 });
        return;
      }

      await composer.locator.press("Enter").catch(() => {});
    }
  );

  const ok =
    networkResult.status === 200 &&
    networkResult.responseJson?.status_code === 0 &&
    Boolean(networkResult.responseJson?.comment?.cid);

  if (!ok) {
    throw createHttpError(
      "The browser lab comment action did not return a successful response.",
      502,
      "DOUYIN_BROWSER_LAB_ACTION_FAILED",
      {
        actionType: "comment",
        activationStrategy,
        composerStrategy: composer.strategy,
        ...networkResult,
      }
    );
  }

  return {
    actionType: "comment",
    skipped: false,
    activationStrategy,
    composerStrategy: composer.strategy,
    method: "browser-lab",
    ok: true,
    ...networkResult,
  };
}

async function createLabBrowserSession(work, options = {}) {
  const executablePath = await resolveExecutablePath();
  if (!executablePath) {
    throw createHttpError(
      "No Edge or Chrome executable was found on this machine.",
      500,
      "BROWSER_EXECUTABLE_MISSING"
    );
  }

  const workUrl = buildWorkUrl(work);
  if (!workUrl) {
    throw createHttpError(
      "The task is missing a work URL and aweme ID fallback.",
      400,
      "WORK_URL_MISSING"
    );
  }

  const headless = options.headless === undefined ? true : Boolean(options.headless);
  const viewport = headless ? { width: 1366, height: 768 } : null;
  const launchArgs = headless ? [] : ["--start-maximized"];
  const profiles = resolveSessionProfileSequence(options);
  let lastError = null;

  for (let index = 0; index < profiles.length; index += 1) {
    const profile = profiles[index];
    const isLastProfile = index === profiles.length - 1;
    let context = null;
    let page = null;

    try {
      context = await launchPersistentDouyinContext({
        executablePath,
        headless,
        profileDir: profile.profileDir,
        locale: "zh-CN",
        viewport,
        args: launchArgs,
        lockOwner: profile.lockOwner,
      });

      await maybeSeedPreferredCookies(context, workUrl);
      page = context.pages()[0] || (await context.newPage());
      await page.goto(workUrl, {
        waitUntil: "domcontentloaded",
        timeout: env.actionBrowserTimeoutMs || 60000,
      });
      await page.waitForTimeout(4000);
      const health = await inspectLabSessionHealth(context, page);

      if (!health.loginReady) {
        const error = createHttpError(
          `${profile.label} is not logged in or is blocked by verification.`,
          409,
          "DOUYIN_RUNTIME_LOGIN_REQUIRED",
          {
            ...health,
            profileKey: profile.profileKey,
            profileDir: profile.profileDir,
            profileLabel: profile.label,
          }
        );

        if (!headless && isLastProfile) {
          await holdVisibleBrowserForRecovery(page, error);
        }

        throw error;
      }

      return {
        context,
        page,
        workUrl,
        health,
        profile,
      };
    } catch (error) {
      lastError = error;
      if (context) {
        await context.close().catch(() => {});
      }

      const canTryNextProfile =
        !isLastProfile &&
        (error?.code === "DOUYIN_RUNTIME_LOGIN_REQUIRED" ||
          error?.code === "BROWSER_PROFILE_LOCKED");

      if (canTryNextProfile) {
        continue;
      }

      throw error;
    }
  }

  throw lastError || createHttpError(
    "No available browser session profile could be prepared.",
    500,
    "BROWSER_SESSION_UNAVAILABLE"
  );
}

export async function withBrowserLabSession(work, options, callback) {
  const session = await createLabBrowserSession(work, options);

  try {
    return await callback(session);
  } finally {
    await session.context.close().catch(() => {});
  }
}

export async function executeBrowserLabTask(task, work, options = {}) {
  return withBrowserLabSession(work, options, async ({ page, health, workUrl, profile }) => {
    const actionResult = await executeBrowserLabTaskInSession(task, { page });
    return {
      method: "browser-lab",
      profileDir: profile?.profileDir || LAB_PROFILE_DIR,
      profileKey: profile?.profileKey || PROFILE_LAB,
      workUrl,
      sessionHealth: health,
      actionResult,
    };
  });
}

export async function executeBrowserLabTaskInSession(task, { page }) {
  if (task.actionType === "like") {
    return runLike(page);
  }

  if (task.actionType === "collect") {
    return runCollect(page);
  }

  if (task.actionType === "follow") {
    return runFollow(page);
  }

  if (task.actionType === "comment") {
    return runComment(page, task.draftText || "");
  }

  throw createHttpError(
    `Unsupported action type: ${task.actionType}`,
    400,
    "ACTION_TYPE_UNSUPPORTED"
  );
}
