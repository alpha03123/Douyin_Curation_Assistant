import path from "node:path";
import { mkdir } from "node:fs/promises";
import { env } from "../../config/env.js";
import { ensureDouyinAuth } from "./auth.js";
import {
  BROWSER_PROFILE_DIR,
  containsDouyinLoginPrompt,
  hasUsableDouyinSessionCookies,
  launchPersistentDouyinContext,
  resolveExecutablePath,
} from "./browserSearchService.js";

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

function isVerificationPage({ url, title, html }) {
  return (
    url.includes("captcha") ||
    url.includes("verify") ||
    title.includes("验证码") ||
    html.includes("验证码中间页") ||
    html.includes("verify_check") ||
    html.includes("secsdk-captcha")
  );
}

function isLoginRequiredPage({ url, title, html, text }) {
  return (
    url.includes("/login") ||
    containsDouyinLoginPrompt(title) ||
    containsDouyinLoginPrompt(html) ||
    containsDouyinLoginPrompt(text)
  );
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

async function getVisibleLoginOverlay(page) {
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
        text.includes("立即登录") ||
        text.includes("扫码登录") ||
        text.includes("登录后") ||
        String(candidate.id || "").startsWith("login-full-panel-");

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
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      }
    }

    return null;
  });
}

async function assertNoVisibleLoginOverlay(page, details = null) {
  const loginOverlay = await getVisibleLoginOverlay(page);
  if (!loginOverlay) {
    return;
  }

  throw createHttpError(
    "Douyin runtime browser is not logged in. Open the runtime browser session, complete login in the browser window, then retry this task.",
    409,
    "DOUYIN_RUNTIME_LOGIN_REQUIRED",
    {
      ...(details || {}),
      loginOverlay,
    }
  );
}

async function captureFailureArtifact(page, taskId) {
  try {
    const artifactDir = path.resolve(env.projectRoot, ".runtime", "action-failures");
    await mkdir(artifactDir, { recursive: true });
    const artifactPath = path.resolve(
      artifactDir,
      `${taskId}-${Date.now()}.png`
    );
    await page.screenshot({
      path: artifactPath,
      fullPage: false,
    });
    return artifactPath;
  } catch {
    return "";
  }
}

async function waitForPageReady(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: env.actionBrowserTimeoutMs });
  await page.waitForTimeout(3500);

  const title = await page.title();
  const html = await page.content();
  const bodyText = await page.locator("body").innerText({ timeout: 2500 }).catch(() => "");
  const currentUrl = page.url();

  if (isVerificationPage({ url: currentUrl, title, html })) {
    throw createHttpError(
      "Douyin verification is required before executing this action.",
      409,
      "DOUYIN_VERIFY_CHECK",
      { url: currentUrl, title }
    );
  }

  if (isLoginRequiredPage({ url: currentUrl, title, html, text: bodyText })) {
    throw createHttpError(
      "Douyin runtime browser is not logged in. Open the runtime browser session, complete login in the browser window, then retry this task.",
      409,
      "DOUYIN_RUNTIME_LOGIN_REQUIRED",
      {
        url: currentUrl,
        title,
        bodyPreview: bodyText.slice(0, 240),
      }
    );
  }

  await assertNoVisibleLoginOverlay(page, {
    url: currentUrl,
    title,
    bodyPreview: bodyText.slice(0, 240),
  });

  return {
    url: currentUrl,
    title,
    bodyPreview: bodyText.slice(0, 180),
  };
}

async function ensureRuntimeSession(context) {
  const existingCookies = await context.cookies("https://www.douyin.com");
  if (hasUsableDouyinSessionCookies(existingCookies)) {
    return {
      seededFromEnv: false,
      hasSessionCookie: true,
    };
  }

  if (!env.dyCookies) {
    return {
      seededFromEnv: false,
      hasSessionCookie: false,
    };
  }

  const auth = ensureDouyinAuth(env.dyCookies);
  await context.addCookies(toBrowserCookies(auth.cookie));

  const refreshedCookies = await context.cookies("https://www.douyin.com");
  return {
    seededFromEnv: true,
    hasSessionCookie: hasUsableDouyinSessionCookies(refreshedCookies),
  };
}

async function optionalClick(locator) {
  try {
    await locator.first().click({ timeout: 1500 });
    return true;
  } catch {
    return false;
  }
}

async function clickNamedControl(page, actionType) {
  const namedPatterns = {
    like: ["点赞", "取消点赞", "已点赞", "喜欢"],
    collect: ["收藏", "取消收藏", "已收藏"],
    commentTrigger: ["评论", "说点什么", "留下你的精彩评论吧"],
    commentSubmit: ["发送", "发布", "评论"],
  };

  const selectorMap = {
    like: [
      '[aria-label*="点赞"]',
      '[title*="点赞"]',
      '[data-e2e*="like"]',
      'button:has-text("点赞")',
      '[role="button"]:has-text("点赞")',
      'button:has-text("喜欢")',
      '[role="button"]:has-text("喜欢")',
    ],
    collect: [
      '[aria-label*="收藏"]',
      '[title*="收藏"]',
      '[data-e2e*="collect"]',
      '[data-e2e*="favorite"]',
      'button:has-text("收藏")',
      '[role="button"]:has-text("收藏")',
    ],
    commentTrigger: [
      'button:has-text("评论")',
      '[role="button"]:has-text("评论")',
      'button:has-text("说点什么")',
      '[role="button"]:has-text("说点什么")',
    ],
    commentSubmit: [
      'button:has-text("发送")',
      '[role="button"]:has-text("发送")',
      'button:has-text("发布")',
      '[role="button"]:has-text("发布")',
      '[data-e2e*="comment-post"]',
    ],
  };

  const patterns = namedPatterns[actionType] || [];
  const selectors = selectorMap[actionType] || [];
  const attempts = [];

  for (const pattern of patterns) {
    const locators = [
      page.getByRole("button", { name: new RegExp(pattern) }),
      page.getByRole("link", { name: new RegExp(pattern) }),
      page.getByText(pattern, { exact: false }),
    ];

    for (const locator of locators) {
      try {
        await locator.first().waitFor({ state: "visible", timeout: 1500 });
        await locator.first().scrollIntoViewIfNeeded().catch(() => {});
        await locator.first().click({ timeout: 5000 });
        return {
          strategy: `name:${pattern}`,
        };
      } catch (error) {
        attempts.push(`name:${pattern}:${error.message}`);
      }
    }
  }

  for (const selector of selectors) {
    const locator = page.locator(selector);

    try {
      await locator.first().waitFor({ state: "visible", timeout: 1500 });
      await locator.first().scrollIntoViewIfNeeded().catch(() => {});
      await locator.first().click({ timeout: 5000 });
      return {
        strategy: `selector:${selector}`,
      };
    } catch (error) {
      attempts.push(`selector:${selector}:${error.message}`);
    }
  }

  throw createHttpError(
    `Could not find a clickable Douyin control for action ${actionType}.`,
    422,
    "DOUYIN_ACTION_SELECTOR_NOT_FOUND",
    { actionType, attempts }
  );
}

function buildDetailActionLocator(page, actionType) {
  const actionIndexMap = {
    like: 0,
    commentTrigger: 1,
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
      `No detail action mapping exists for ${actionType}.`,
      422,
      "DOUYIN_ACTION_SELECTOR_NOT_FOUND"
    );
  }

  const clickableLocator = locator.locator('[tabindex="0"]').first();
  const targetLocator =
    (await clickableLocator.count().catch(() => 0)) > 0 ? clickableLocator : locator;

  await targetLocator.waitFor({ state: "visible", timeout: 3000 });
  await targetLocator.scrollIntoViewIfNeeded().catch(() => {});

  try {
    await targetLocator.click({ timeout: 5000 });
  } catch (error) {
    await assertNoVisibleLoginOverlay(page, {
      phase: actionType,
      triggerError: error.message,
    });
    throw error;
  }

  return {
    strategy: `detail-strip:${actionType}`,
  };
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

  return page
    .locator(selector)
    .first()
    .getAttribute("data-e2e-state")
    .catch(() => "") || "";
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

async function ensureReactionApplied(page, actionType, beforeState) {
  const selector = getActionStateSelector(actionType);
  if (!selector) {
    return beforeState;
  }

  await page
    .waitForFunction(
      ({ targetSelector, previousState }) => {
        const element = document.querySelector(targetSelector);
        if (!element) {
          return false;
        }

        const nextState = element.getAttribute("data-e2e-state") || "";
        return nextState !== previousState;
      },
      { targetSelector: selector, previousState: beforeState },
      { timeout: 4000 }
    )
    .catch(() => {});

  return readReactionState(page, actionType);
}

async function openCommentSection(page) {
  await clickDetailAction(page, "commentTrigger");
  await page.waitForTimeout(1000);
  await assertNoVisibleLoginOverlay(page, {
    phase: "comment-open",
  });
}

async function resolveDetailCommentComposer(page) {
  const inputSelectors = [
    'textarea[placeholder*="精彩评论"]',
    'textarea[placeholder*="说点什么"]',
    'textarea[placeholder*="评论"]',
    'input[placeholder*="精彩评论"]',
    'input[placeholder*="说点什么"]',
    '[contenteditable="true"][placeholder*="精彩评论"]',
    '[contenteditable="true"][placeholder*="说点什么"]',
    '[contenteditable="true"][placeholder*="评论"]',
    '[contenteditable="true"][data-e2e*="comment"]',
  ];

  for (const selector of inputSelectors) {
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

async function resolveCommentComposer(page) {
  const inputSelectors = [
    'textarea[placeholder*="评论"]',
    'textarea[placeholder*="留下"]',
    'textarea',
    '[contenteditable="true"][placeholder*="评论"]',
    '[contenteditable="true"][data-e2e*="comment"]',
    '[contenteditable="true"]',
  ];

  for (const selector of inputSelectors) {
    const locator = page.locator(selector);

    try {
      await locator.first().waitFor({ state: "visible", timeout: 1500 });
      return {
        locator: locator.first(),
        strategy: selector,
      };
    } catch {
      continue;
    }
  }

  await optionalClick(page.locator('button:has-text("评论"), [role="button"]:has-text("评论")'));
  await page.waitForTimeout(800);

  for (const selector of inputSelectors) {
    const locator = page.locator(selector);

    try {
      await locator.first().waitFor({ state: "visible", timeout: 1500 });
      return {
        locator: locator.first(),
        strategy: selector,
      };
    } catch {
      continue;
    }
  }

  throw createHttpError(
    "Could not find the Douyin comment composer on the current page.",
    422,
    "DOUYIN_COMMENT_COMPOSER_NOT_FOUND"
  );
}

async function fillCommentComposer(locator, text) {
  const tagName = await locator.evaluate((node) => node.tagName.toLowerCase());
  const isContentEditable = await locator.evaluate(
    (node) => node.getAttribute("contenteditable") === "true"
  );

  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.click({ timeout: 5000 });

  if (tagName === "textarea" || tagName === "input") {
    await locator.fill(text, { timeout: 5000 });
    return;
  }

  if (isContentEditable) {
    await locator.evaluate((node) => {
      node.textContent = "";
      node.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
    await locator.pressSequentially(text, { delay: 40 });
    return;
  }

  throw createHttpError(
    "The Douyin comment composer was found, but its input type is unsupported.",
    422,
    "DOUYIN_COMMENT_COMPOSER_UNSUPPORTED"
  );
}

async function executeLike(page) {
  const beforeState = await readReactionState(page, "like");
  if (isReactionApplied("like", beforeState)) {
    return {
      strategy: "state:already-liked",
      stateBefore: beforeState,
      stateAfter: beforeState,
    };
  }

  const result = await clickDetailAction(page, "like");
  await page.waitForTimeout(1200);
  await assertNoVisibleLoginOverlay(page, {
    phase: "like",
  });
  const afterState = await ensureReactionApplied(page, "like", beforeState);

  if (!isReactionApplied("like", afterState)) {
    throw createHttpError(
      "The Douyin like button was clicked, but the page did not confirm a successful like.",
      422,
      "DOUYIN_ACTION_NOT_CONFIRMED",
      {
        actionType: "like",
        beforeState,
        afterState,
      }
    );
  }

  return {
    ...result,
    stateBefore: beforeState,
    stateAfter: afterState,
  };
}

async function executeCollect(page) {
  const beforeState = await readReactionState(page, "collect");
  if (isReactionApplied("collect", beforeState)) {
    return {
      strategy: "state:already-collected",
      stateBefore: beforeState,
      stateAfter: beforeState,
    };
  }

  const result = await clickDetailAction(page, "collect");
  await page.waitForTimeout(1200);
  await assertNoVisibleLoginOverlay(page, {
    phase: "collect",
  });
  const afterState = await ensureReactionApplied(page, "collect", beforeState);

  if (!isReactionApplied("collect", afterState)) {
    throw createHttpError(
      "The Douyin collect button was clicked, but the page did not confirm a successful collect.",
      422,
      "DOUYIN_ACTION_NOT_CONFIRMED",
      {
        actionType: "collect",
        beforeState,
        afterState,
      }
    );
  }

  return {
    ...result,
    stateBefore: beforeState,
    stateAfter: afterState,
  };
}

async function executeComment(page, draftText) {
  if (!draftText?.trim()) {
    throw createHttpError(
      "Comment task is missing draft text.",
      400,
      "COMMENT_DRAFT_REQUIRED"
    );
  }

  await openCommentSection(page);
  const composer =
    (await resolveDetailCommentComposer(page)) || (await resolveCommentComposer(page));
  await fillCommentComposer(composer.locator, draftText.trim());
  await page.waitForTimeout(600);

  let submitResult = null;
  try {
    submitResult = await clickNamedControl(page, "commentSubmit");
  } catch {
    await composer.locator.press("Enter").catch(() => {});
    submitResult = {
      strategy: `${composer.strategy}:enter`,
    };
  }

  await page.waitForTimeout(1200);
  return {
    composerStrategy: composer.strategy,
    submitStrategy: submitResult.strategy,
  };
}

export async function executeDouyinBrowserAction(task, work, options = {}) {
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

  const headless =
    options.headless === undefined
      ? env.actionBrowserHeadless
      : Boolean(options.headless);
  const keepOpenOnFailure =
    options.keepOpenOnFailure === undefined
      ? env.actionBrowserKeepOpenOnFailure
      : Boolean(options.keepOpenOnFailure);
  const context = await launchPersistentDouyinContext({
    executablePath,
    headless,
  });

  try {
    const runtimeSession = await ensureRuntimeSession(context);
    const page = await context.newPage();
    await page.goto(workUrl, {
      waitUntil: "domcontentloaded",
      timeout: env.actionBrowserTimeoutMs,
    });
    const pageInfo = await waitForPageReady(page);

    let actionResult = null;
    if (task.actionType === "like") {
      actionResult = await executeLike(page);
    } else if (task.actionType === "collect") {
      actionResult = await executeCollect(page);
    } else if (task.actionType === "comment") {
      actionResult = await executeComment(page, task.draftText || "");
    } else {
      throw createHttpError(
        `Unsupported action type: ${task.actionType}`,
        400,
        "ACTION_TYPE_UNSUPPORTED"
      );
    }

    return {
      method: "browser-automation",
      executablePath,
      profileDir: BROWSER_PROFILE_DIR,
      workUrl,
      runtimeSession,
      pageInfo,
      actionResult,
    };
  } catch (error) {
    const page = context.pages().at(-1);
    if (page) {
      const screenshotPath = await captureFailureArtifact(page, String(task._id || "action-task"));
      if (screenshotPath) {
        error.details = {
          ...(error.details || {}),
          screenshotPath,
        };
      }

      if (keepOpenOnFailure && !headless) {
        error.details = {
          ...(error.details || {}),
          browserKeptOpen: true,
          browserFailureHoldMs: env.actionBrowserFailureHoldMs,
        };
        await page.bringToFront().catch(() => {});
        await page.waitForTimeout(env.actionBrowserFailureHoldMs);
      }
    }

    throw error;
  } finally {
    await context.close().catch(() => {});
  }
}
