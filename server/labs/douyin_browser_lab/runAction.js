import path from "node:path";
import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import {
  ensureDouyinAuth,
  getSharedDouyinCookieString,
} from "../../src/services/douyin/auth.js";
import {
  resolveExecutablePath,
  stopBrowsersUsingProfile,
} from "../../src/services/douyin/browserSearchService.js";
import {
  LAB_DEFAULT_TARGET_URL,
  LAB_PROFILE_DIR,
  LAB_RUN_ROOT_DIR,
} from "./labConfig.js";
import { inspectSessionHealth } from "./sessionHealth.js";

function parseArgs(argv) {
  const options = {
    action: "bundle",
    targetUrl: LAB_DEFAULT_TARGET_URL,
    commentText: "test",
    keepBrowserOpen: false,
  };
  const positionalArgs = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--action" && argv[index + 1]) {
      options.action = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--target-url" && argv[index + 1]) {
      options.targetUrl = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--comment-text" && argv[index + 1]) {
      options.commentText = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--keep-browser-open") {
      options.keepBrowserOpen = true;
      continue;
    }

    if (!String(arg).startsWith("--")) {
      positionalArgs.push(arg);
    }
  }

  const validActions = new Set(["like", "collect", "comment", "bundle"]);
  if (positionalArgs.length > 0) {
    const [firstArg, secondArg, thirdArg] = positionalArgs;

    if (validActions.has(firstArg)) {
      options.action = firstArg;
      if (secondArg) {
        if (String(secondArg).startsWith("http")) {
          options.targetUrl = secondArg;
          if (thirdArg) {
            options.commentText = thirdArg;
          }
        } else {
          options.commentText = secondArg;
          if (thirdArg && String(thirdArg).startsWith("http")) {
            options.targetUrl = thirdArg;
          }
        }
      }
    } else if (String(firstArg).startsWith("http")) {
      options.targetUrl = firstArg;
      if (secondArg) {
        options.commentText = secondArg;
      }
    }
  }

  if (!validActions.has(options.action)) {
    throw new Error(
      `Unsupported --action "${options.action}". Use one of: ${[
        ...validActions,
      ].join(", ")}.`
    );
  }

  return options;
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

async function maybeSeedSharedCookies(context) {
  try {
    const cookieString = getSharedDouyinCookieString();
    const existingCookies = await context.cookies("https://www.douyin.com");
    const hasSessionCookie = existingCookies.some((item) =>
      ["sessionid", "sessionid_ss", "sid_tt", "uid_tt", "sid_guard"].includes(
        item.name
      )
    );

    if (hasSessionCookie) {
      return;
    }

    const auth = ensureDouyinAuth(cookieString);
    await context.addCookies(toBrowserCookies(auth.cookie));
  } catch {
    // The runner can still proceed if the profile itself is already logged in.
  }
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

async function clickDetailAction(page, actionType) {
  const locator = buildDetailActionLocator(page, actionType);
  if (!locator) {
    throw new Error(`Unsupported actionType "${actionType}" for detail action click.`);
  }

  const clickableLocator = locator.locator('[tabindex="0"]').first();
  const hasClickable = (await clickableLocator.count().catch(() => 0)) > 0;
  const targetLocator = hasClickable ? clickableLocator : locator;

  await targetLocator.waitFor({ state: "visible", timeout: 8000 });
  await targetLocator.scrollIntoViewIfNeeded().catch(() => {});
  await targetLocator.click({ timeout: 8000 });
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

async function ensureLoggedIn(context, page) {
  const health = await inspectSessionHealth(context, page);
  if (!health.loginReady) {
    throw new Error(
      `Lab browser is not logged in or is blocked by verification. loginReady=${health.loginReady}, hasSessionCookie=${health.hasSessionCookie}, loginPrompt=${health.loginPromptVisible}, verify=${health.verificationRequired}, url=${health.currentUrl}` // eslint-disable-line max-len
    );
  }

  return health;
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

  throw new Error("Could not activate the comment composer container.");
}

async function resolveCommentComposer(page) {
  const selectors = [
    '#comment-input-container .public-DraftEditor-content[contenteditable="true"]',
    '#comment-input-container .DraftEditor-editorContainer [contenteditable="true"]',
    '#comment-input-container [contenteditable="true"][role="combobox"]',
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

  throw new Error("Could not find a visible comment composer in the lab browser.");
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

  throw new Error("Unsupported comment composer type.");
}

async function runLike(page) {
  const beforeState = await readReactionState(page, "like");
  if (isReactionApplied("like", beforeState)) {
    return {
      actionType: "like",
      ok: true,
      skipped: true,
      reason: "already-liked",
      stateBefore: beforeState,
      stateAfter: beforeState,
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

  return {
    actionType: "like",
    ok,
    skipped: false,
    stateBefore: beforeState,
    stateAfter: afterState,
    ...networkResult,
  };
}

async function runCollect(page) {
  const beforeState = await readReactionState(page, "collect");
  if (isReactionApplied("collect", beforeState)) {
    return {
      actionType: "collect",
      ok: true,
      skipped: true,
      reason: "already-collected",
      stateBefore: beforeState,
      stateAfter: beforeState,
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

  return {
    actionType: "collect",
    ok,
    skipped: false,
    stateBefore: beforeState,
    stateAfter: afterState,
    ...networkResult,
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

  return {
    actionType: "comment",
    ok,
    skipped: false,
    activationStrategy,
    composerStrategy: composer.strategy,
    ...networkResult,
  };
}

function trimForOutput(value = "", limit = 300) {
  const safeValue = String(value ?? "");
  if (safeValue.length <= limit) {
    return safeValue;
  }

  return `${safeValue.slice(0, limit)}...[truncated]`;
}

async function saveRunResult(result) {
  await mkdir(LAB_RUN_ROOT_DIR, { recursive: true });
  const filePath = path.resolve(
    LAB_RUN_ROOT_DIR,
    `run-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );
  await writeFile(filePath, JSON.stringify(result, null, 2), "utf8");
  return filePath;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const executablePath = await resolveExecutablePath();
  if (!executablePath) {
    throw new Error("No Edge or Chrome executable was found on this machine.");
  }

  await stopBrowsersUsingProfile(LAB_PROFILE_DIR);

  const context = await chromium.launchPersistentContext(LAB_PROFILE_DIR, {
    executablePath,
    headless: false,
    locale: "zh-CN",
    viewport: null,
    args: ["--start-maximized"],
  });

  try {
    await maybeSeedSharedCookies(context);
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(options.targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(4000);
    const health = await ensureLoggedIn(context, page);

    const requestedActions =
      options.action === "bundle"
        ? ["like", "collect", "comment"]
        : [options.action];
    const results = [];

    for (const actionType of requestedActions) {
      let result = null;
      if (actionType === "like") {
        result = await runLike(page);
      } else if (actionType === "collect") {
        result = await runCollect(page);
      } else {
        result = await runComment(page, options.commentText);
      }

      results.push(result);
      console.log(
        `[lab:run-action] ${actionType} ok=${result.ok} status=${result.status || "-"} skipped=${Boolean(result.skipped)}`
      );

      if (!result.ok) {
        break;
      }

      await page.waitForTimeout(1200);
    }

    const finalResult = {
      generatedAt: new Date().toISOString(),
      targetUrl: options.targetUrl,
      action: options.action,
      commentText: options.commentText,
      health,
      items: results,
    };
    const outputPath = await saveRunResult(finalResult);

    console.log(`[lab:run-action] resultFile=${outputPath}`);
    console.log(
      JSON.stringify(
        results.map((item) => ({
          actionType: item.actionType,
          ok: item.ok,
          skipped: item.skipped,
          reason: item.reason || "",
          status: item.status || null,
          requestUrl: trimForOutput(item.url || "", 180),
          responseText: trimForOutput(item.responseText || "", 220),
        })),
        null,
        2
      )
    );

    if (options.keepBrowserOpen) {
      console.log(
        "[lab:run-action] keep-browser-open is enabled. Close the browser manually."
      );
      await context.waitForEvent("close", { timeout: 0 });
      return;
    }
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error("[lab:run-action] failed", error);
  process.exit(1);
});
