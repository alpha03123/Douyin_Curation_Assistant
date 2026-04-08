import crypto from "node:crypto";
import path from "node:path";
import { chromium } from "playwright-core";
import { env } from "../../src/config/env.js";
import {
  ensureDouyinAuth,
  getSharedDouyinCookieString,
} from "../../src/services/douyin/auth.js";
import {
  resolveExecutablePath,
  stopBrowsersUsingProfile,
} from "../../src/services/douyin/browserSearchService.js";
import { CaptureStore, trimText } from "./captureStore.js";
import {
  HOTKEY_HINTS,
  LAB_CAPTURE_ROOT_DIR,
  LAB_DEFAULT_TARGET_URL,
  LAB_PROFILE_DIR,
} from "./labConfig.js";
import { startSessionHealthMonitor } from "./sessionHealth.js";
const ACTION_HINTS = [
  "digg",
  "like",
  "collect",
  "favorite",
  "comment",
  "publish",
  "commit",
  "reply",
  "login",
  "captcha",
  "verify",
  "aweme/stats",
];
const FILTER_MODES = new Set(["action", "xhr", "all"]);

function parseArgs(argv) {
  const options = {
    filter: "action",
    targetUrl: LAB_DEFAULT_TARGET_URL,
    healthIntervalMs: 30000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--filter" && argv[index + 1]) {
      options.filter = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--target-url" && argv[index + 1]) {
      options.targetUrl = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--health-interval-ms" && argv[index + 1]) {
      options.healthIntervalMs = Math.max(5000, Number(argv[index + 1]) || 30000);
      index += 1;
      continue;
    }
  }

  if (!FILTER_MODES.has(options.filter)) {
    throw new Error(
      `Unsupported --filter value "${options.filter}". Use one of: ${[
        ...FILTER_MODES,
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

function shouldCaptureRequest(request, filterMode) {
  const resourceType = request.resourceType();
  const method = request.method().toUpperCase();
  const url = String(request.url() || "").toLowerCase();

  if (filterMode === "all") {
    return true;
  }

  if (filterMode === "xhr") {
    return ["xhr", "fetch", "beacon", "document"].includes(resourceType);
  }

  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return true;
  }

  if (["xhr", "fetch", "beacon"].includes(resourceType)) {
    return ACTION_HINTS.some((keyword) => url.includes(keyword));
  }

  return false;
}

function shouldReadResponseBody(headers = {}) {
  const contentType =
    headers["content-type"] ||
    headers["Content-Type"] ||
    "";
  const loweredContentType = String(contentType).toLowerCase();

  return (
    loweredContentType.includes("json") ||
    loweredContentType.includes("text/") ||
    loweredContentType.includes("javascript") ||
    loweredContentType.includes("html") ||
    loweredContentType.includes("xml") ||
    loweredContentType.includes("form-urlencoded")
  );
}

function getRequestContextDetails(request) {
  try {
    const frame = request.frame();
    const page = frame?.page?.() || null;

    return {
      source: "frame",
      frame,
      page,
      frameUrl: frame?.url?.() || "",
      pageUrl: page?.url?.() || "",
    };
  } catch (error) {
    const serviceWorker = request.serviceWorker?.() || null;

    return {
      source: serviceWorker ? "service-worker" : "no-frame",
      frame: null,
      page: null,
      frameUrl: "",
      pageUrl: "",
      serviceWorkerUrl: serviceWorker?.url?.() || "",
      contextError: error.message,
    };
  }
}

function buildTerminalLabel(record) {
  const parts = [
    `[lab:${record.type}]`,
  ];

  if (record.type === "request") {
    parts.push(record.payload.method);
    parts.push(record.payload.url);
  } else if (record.type === "response") {
    parts.push(String(record.payload.status));
    parts.push(record.payload.method);
    parts.push(record.payload.url);
  } else if (record.type === "request-failed") {
    parts.push(record.payload.method);
    parts.push(record.payload.url);
    parts.push(record.payload.failureText);
  } else if (record.type === "manual-marker") {
    parts.push(record.payload.label);
    parts.push(record.payload.pageUrl || "");
  } else if (record.type === "console") {
    parts.push(record.payload.consoleType);
    parts.push(record.payload.text);
  } else if (record.type === "page-error") {
    parts.push(record.payload.message);
  }

  return parts.filter(Boolean).join(" ");
}

async function maybeSeedSharedCookies(context, captureStore) {
  try {
    const cookieString = getSharedDouyinCookieString();
    const existingCookies = await context.cookies("https://www.douyin.com");
    const hasSessionCookie = existingCookies.some((item) =>
      ["sessionid", "sessionid_ss", "sid_tt", "uid_tt", "sid_guard"].includes(
        item.name
      )
    );

    if (hasSessionCookie) {
      captureStore.append({
        type: "cookie-seed-skipped",
        payload: {
          reason: "profile-already-has-session-cookie",
        },
      });
      return;
    }

    const auth = ensureDouyinAuth(cookieString);
    await context.addCookies(toBrowserCookies(auth.cookie));
    captureStore.append({
      type: "cookie-seeded",
      payload: {
        cookieCount: Object.keys(auth.cookie).length,
      },
    });
  } catch (error) {
    captureStore.append({
      type: "cookie-seed-skipped",
      payload: {
        reason: error.code || error.message,
      },
    });
  }
}

async function registerManualMarkerBindings(context, captureStore) {
  await context.exposeFunction("__douyinLabEmitMarker", async (payload = {}) => {
    const record = captureStore.append({
      type: "manual-marker",
      payload: {
        label: payload.label || "note",
        key: payload.key || "",
        pageUrl: payload.pageUrl || "",
        title: payload.title || "",
      },
    });
    console.log(buildTerminalLabel(record));
  });

  await context.addInitScript(() => {
    if (window.__DOUYIN_LAB_MARKER_BOUND__) {
      return;
    }

    window.__DOUYIN_LAB_MARKER_BOUND__ = true;
    window.addEventListener("keydown", (event) => {
      if (!event.ctrlKey || !event.shiftKey) {
        return;
      }

      const labelMap = {
        Digit1: "like",
        Digit2: "collect",
        Digit3: "comment",
        Digit4: "note",
      };
      const label = labelMap[event.code];
      if (!label || typeof window.__douyinLabEmitMarker !== "function") {
        return;
      }

      window.__douyinLabEmitMarker({
        label,
        key: event.code,
        pageUrl: window.location.href,
        title: document.title,
      });
    }, true);
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sessionId = `watch-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
  const captureStore = new CaptureStore({
    rootDir: LAB_CAPTURE_ROOT_DIR,
    sessionId,
    filterMode: options.filter,
  });
  await captureStore.init();

  const executablePath = await resolveExecutablePath();
  if (!executablePath) {
    throw new Error("No Edge or Chrome executable was found on this machine.");
  }

  const releaseResult = await stopBrowsersUsingProfile(LAB_PROFILE_DIR);
  captureStore.append({
    type: "profile-release",
    payload: {
      stopped: releaseResult.stopped,
      processIds: releaseResult.processIds,
      profileDir: LAB_PROFILE_DIR,
    },
  });

  const context = await chromium.launchPersistentContext(LAB_PROFILE_DIR, {
    executablePath,
    headless: false,
    locale: "zh-CN",
    viewport: null,
    args: ["--start-maximized"],
  });

  let isShuttingDown = false;
  const pageIds = new WeakMap();
  const requestIds = new WeakMap();
  let pageSequence = 0;
  let requestSequence = 0;

  const getPageId = (page) => {
    if (!page) {
      return "";
    }

    const existingPageId = pageIds.get(page);
    if (existingPageId) {
      return existingPageId;
    }

    const nextPageId = `page-${++pageSequence}`;
    pageIds.set(page, nextPageId);
    return nextPageId;
  };

  const getActivePage = () => {
    const pages = context.pages().filter((page) => !page.isClosed());
    return pages.at(-1) || null;
  };

  const emit = (event) => {
    const record = captureStore.append(event);
    if (
      ["request", "response", "request-failed", "manual-marker", "console", "page-error"]
        .includes(record.type)
    ) {
      console.log(buildTerminalLabel(record));
    }

    return record;
  };

  const attachPageListeners = (page) => {
    const pageId = getPageId(page);
    emit({
      type: "page-attached",
      payload: {
        pageId,
        url: page.url(),
      },
    });

    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) {
        return;
      }

      emit({
        type: "page-navigated",
        payload: {
          pageId,
          url: frame.url(),
          title: "",
        },
      });
    });

    page.on("console", (message) => {
      emit({
        type: "console",
        payload: {
          pageId,
          pageUrl: page.url(),
          consoleType: message.type(),
          text: trimText(message.text(), 2000),
        },
      });
    });

    page.on("pageerror", (error) => {
      emit({
        type: "page-error",
        payload: {
          pageId,
          pageUrl: page.url(),
          message: error.message,
          stack: trimText(error.stack || "", 4000),
        },
      });
    });

    page.on("dialog", (dialog) => {
      emit({
        type: "dialog",
        payload: {
          pageId,
          pageUrl: page.url(),
          dialogType: dialog.type(),
          message: trimText(dialog.message(), 1000),
        },
      });
    });

    page.on("close", () => {
      emit({
        type: "page-closed",
        payload: {
          pageId,
          pageUrl: page.url(),
        },
      });
    });
  };

  await registerManualMarkerBindings(context, captureStore);
  await maybeSeedSharedCookies(context, captureStore);

  for (const page of context.pages()) {
    attachPageListeners(page);
  }

  context.on("page", (page) => {
    attachPageListeners(page);
  });

  context.on("request", (request) => {
    if (!shouldCaptureRequest(request, options.filter)) {
      return;
    }

    const requestId = `request-${++requestSequence}`;
    requestIds.set(request, requestId);
    const requestContext = getRequestContextDetails(request);

    emit({
      type: "request",
      payload: {
        requestId,
        pageId: getPageId(requestContext.page),
        pageUrl: requestContext.pageUrl,
        frameUrl: requestContext.frameUrl,
        requestSource: requestContext.source,
        serviceWorkerUrl: requestContext.serviceWorkerUrl || "",
        contextError: requestContext.contextError || "",
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        headers: request.headers(),
        postData: trimText(request.postData() || "", 12000),
      },
    });
  });

  context.on("response", async (response) => {
    const request = response.request();
    const requestId = requestIds.get(request);
    if (!requestId) {
      return;
    }

    const headers = response.headers();
    let responseText = "";
    if (shouldReadResponseBody(headers)) {
      responseText = trimText(await response.text().catch(() => ""), 16000);
    }

    const requestContext = getRequestContextDetails(request);
    emit({
      type: "response",
      payload: {
        requestId,
        pageId: getPageId(requestContext.page),
        pageUrl: requestContext.pageUrl,
        frameUrl: requestContext.frameUrl,
        requestSource: requestContext.source,
        serviceWorkerUrl: requestContext.serviceWorkerUrl || "",
        contextError: requestContext.contextError || "",
        url: response.url(),
        method: request.method(),
        status: response.status(),
        statusText: response.statusText(),
        headers,
        responseText,
      },
    });
  });

  context.on("requestfailed", (request) => {
    const requestId = requestIds.get(request);
    if (!requestId) {
      return;
    }

    const requestContext = getRequestContextDetails(request);
    emit({
      type: "request-failed",
      payload: {
        requestId,
        pageId: getPageId(requestContext.page),
        pageUrl: requestContext.pageUrl,
        frameUrl: requestContext.frameUrl,
        requestSource: requestContext.source,
        serviceWorkerUrl: requestContext.serviceWorkerUrl || "",
        contextError: requestContext.contextError || "",
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        failureText: request.failure()?.errorText || "unknown",
      },
    });
  });

  context.on("close", () => {
    emit({
      type: "browser-context-closed",
      payload: {
        profileDir: LAB_PROFILE_DIR,
      },
    });
  });

  const healthMonitor = startSessionHealthMonitor({
    context,
    getActivePage,
    captureStore,
    intervalMs: options.healthIntervalMs,
    logger: console,
  });

  const page = getActivePage() || (await context.newPage());
  if (!page.url() || page.url() === "about:blank") {
    await page.goto(options.targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
  }

  await healthMonitor.runCheck();

  console.log(`[lab] Browser executable: ${executablePath}`);
  console.log(`[lab] Profile dir: ${LAB_PROFILE_DIR}`);
  console.log(`[lab] Capture file: ${captureStore.liveFilePath}`);
  console.log(`[lab] Summary file: ${captureStore.summaryFilePath}`);
  console.log(`[lab] Target page: ${options.targetUrl}`);
  console.log(`[lab] Filter mode: ${options.filter}`);
  console.log("[lab] Operate only in this watcher-started browser window.");
  console.log("[lab] Hotkeys:");
  for (const hint of HOTKEY_HINTS) {
    console.log(`  - ${hint}`);
  }
  console.log("[lab] Close the browser window or press Ctrl+C to stop.");

  const shutdown = async (signal) => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    healthMonitor.stop();

    try {
      await context.close().catch(() => {});
    } finally {
      await captureStore.close({
        notes: `Watcher stopped by ${signal}.`,
      });
    }
  };

  process.once("SIGINT", () => {
    shutdown("SIGINT").finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    shutdown("SIGTERM").finally(() => process.exit(0));
  });

  await context.waitForEvent("close", { timeout: 0 });
  await shutdown("browser-close");
}

main().catch(async (error) => {
  console.error("[lab] failed", error);
  process.exit(1);
});
