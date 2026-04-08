import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { env } from "../config/env.js";
import { ensureDouyinAuth } from "../services/douyin/auth.js";
import {
  BROWSER_PROFILE_DIR,
  launchPersistentDouyinContext,
  resolveExecutablePath,
} from "../services/douyin/browserSearchService.js";

const ACTION_HINTS = [
  "digg",
  "like",
  "collect",
  "follow",
  "relation",
  "favorite",
  "favourite",
  "comment",
  "publish",
  "commit",
  "reply",
  "aweme/stats",
  "history/write",
];

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

function trimText(value = "", limit = 6000) {
  return value.length > limit ? `${value.slice(0, limit)}\n...[truncated]` : value;
}

function lower(value = "") {
  return String(value).toLowerCase();
}

function shouldCapture(request) {
  const method = request.method().toUpperCase();
  const resourceType = request.resourceType();
  const url = lower(request.url());

  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return true;
  }

  if (["xhr", "fetch", "beacon"].includes(resourceType)) {
    return true;
  }

  return ACTION_HINTS.some((keyword) => url.includes(keyword));
}

function createCaptureItem(request) {
  const frame = request.frame();

  return {
    capturedAt: new Date().toISOString(),
    pageUrl: frame?.url() || "",
    url: request.url(),
    method: request.method(),
    resourceType: request.resourceType(),
    requestHeaders: request.headers(),
    requestPostData: trimText(request.postData() || ""),
    status: null,
    responseHeaders: {},
    responseText: "",
    failureText: "",
  };
}

async function main() {
  if (!env.dyCookies) {
    throw new Error(
      "DY_COOKIES is missing. Fill it in Douyin_Curation_Assistant/.env before capturing requests."
    );
  }

  const executablePath = await resolveExecutablePath();
  if (!executablePath) {
    throw new Error("No Edge or Chrome executable was found on this machine.");
  }

  const auth = ensureDouyinAuth(env.dyCookies);
  const captureDir = path.resolve(env.projectRoot, ".runtime", "action-captures");
  const cliTargetUrl = process.argv[2];
  const targetUrl = cliTargetUrl || env.actionCaptureTargetUrl;

  await mkdir(captureDir, { recursive: true });

  const captureItems = [];
  const requestMap = new WeakMap();
  const context = await launchPersistentDouyinContext({
    executablePath,
    headless: false,
  });

  const attachPageListeners = (page) => {
    page.on("request", (request) => {
      if (!shouldCapture(request)) {
        return;
      }

      const item = createCaptureItem(request);
      requestMap.set(request, item);
      captureItems.push(item);
      console.log(`[capture:request] ${item.method} ${item.url}`);
    });

    page.on("response", async (response) => {
      const request = response.request();
      const item = requestMap.get(request);
      if (!item) {
        return;
      }

      item.status = response.status();
      item.responseHeaders = response.headers();

      try {
        item.responseText = trimText(await response.text());
      } catch (error) {
        item.responseText = `[unavailable] ${error.message}`;
      }

      console.log(`[capture:response] ${item.method} ${item.status} ${item.url}`);
    });

    page.on("requestfailed", (request) => {
      const item = requestMap.get(request);
      if (!item) {
        return;
      }

      item.failureText = request.failure()?.errorText || "unknown";
      console.log(`[capture:failed] ${item.method} ${item.url} ${item.failureText}`);
    });
  };

  for (const page of context.pages()) {
    attachPageListeners(page);
  }

  context.on("page", (page) => {
    attachPageListeners(page);
  });

  try {
    await context.addCookies(toBrowserCookies(auth.cookie));
    const page = context.pages()[0] || (await context.newPage());

    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    console.log("[capture] Browser profile directory:", BROWSER_PROFILE_DIR);
    console.log("[capture] Current browser executable:", executablePath);
    console.log("[capture] Target page:", targetUrl);
    console.log("[capture] Please do the following in the opened browser:");
    console.log("[capture] 1. Stay on this work page.");
    console.log("[capture] 2. Manually click like once, then wait 3-5 seconds.");
    console.log("[capture] 3. Manually click collect once, then wait 3-5 seconds.");
    console.log("[capture] 4. Manually click follow once, then wait 3-5 seconds.");
    console.log("[capture] 5. Manually publish one short comment once, then wait 5-8 seconds.");
    console.log("[capture] 6. Close the browser window after you finish.");

    await context.waitForEvent("close");
  } finally {
    try {
      await context.close();
    } catch {
      // noop
    }
  }

  const filePath = path.resolve(
    captureDir,
    `action-capture-${Date.now()}.json`
  );

  await writeFile(
    filePath,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        executablePath,
        profileDir: BROWSER_PROFILE_DIR,
        targetUrl,
        itemCount: captureItems.length,
        items: captureItems,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log("[capture] Capture file saved:", filePath);
  console.log("[capture] Captured request count:", captureItems.length);
}

main().catch((error) => {
  console.error("[capture] failed", error);
  process.exit(1);
});
