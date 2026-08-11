import { env } from "../config/env.js";
import { ensureDouyinAuth } from "../services/douyin/auth.js";
import {
  BROWSER_PROFILE_DIR,
  hasUsableDouyinSessionCookies,
  launchPersistentDouyinContext,
  resolveExecutablePath,
  serializePlaywrightCookies,
} from "../services/douyin/browserSearchService.js";
import { buildRecommendBootstrapUrl } from "../services/douyin/recommendFeedBrowserService.js";
import { writeRuntimeSessionSnapshot } from "../services/douyin/runtimeSessionCacheService.js";

function parseArgs(argv = []) {
  const options = {
    targetUrl: env.actionCaptureTargetUrl,
    timeoutMs: env.browserLoginTimeoutMs,
    keepOpen: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--target-url" && argv[index + 1]) {
      options.targetUrl = String(argv[index + 1] || "").trim() || options.targetUrl;
      index += 1;
      continue;
    }

    if (arg === "--timeout-ms" && argv[index + 1]) {
      options.timeoutMs = Math.max(60000, Number(argv[index + 1]) || options.timeoutMs);
      index += 1;
      continue;
    }

    if (arg === "--keep-open") {
      options.keepOpen = true;
    }
  }

  return options;
}

async function waitForLoginSession({ flushSnapshot, page, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await flushSnapshot()) {
      return true;
    }

    await page.waitForTimeout(1000);
  }

  return false;
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const bootstrapUrl = buildRecommendBootstrapUrl(options.targetUrl);
  const executablePath = await resolveExecutablePath();
  if (!executablePath) {
    throw new Error("No Edge or Chrome executable was found on this machine.");
  }

  const context = await launchPersistentDouyinContext({
    executablePath,
    headless: false,
  });

  try {
    const existingCookies = await context.cookies("https://www.douyin.com");
    const hasSessionCookie = existingCookies.some((item) =>
      ["sessionid", "sessionid_ss", "sid_tt", "uid_tt", "sid_guard"].includes(item.name)
    );

    if (!hasSessionCookie && env.dyCookies) {
      const auth = ensureDouyinAuth(env.dyCookies);
      await context.addCookies(toBrowserCookies(auth.cookie));
    }

    const page = context.pages()[0] || (await context.newPage());
    await page.goto(bootstrapUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    const flushRuntimeSessionSnapshot = async () => {
      const cookies = await context.cookies("https://www.douyin.com").catch(() => []);
      if (!hasUsableDouyinSessionCookies(cookies)) {
        return null;
      }
      const storageState = await context.storageState().catch(() => null);

      return writeRuntimeSessionSnapshot({
        cookieString: serializePlaywrightCookies(cookies),
        storageState,
        source: "runtime-verification-browser",
        targetUrl: options.targetUrl,
      }).catch(() => null);
    };

    console.log("[prepare-browser] Browser profile directory:", BROWSER_PROFILE_DIR);
    console.log("[prepare-browser] Target page:", options.targetUrl);
    console.log("[prepare-browser] Bootstrap page:", bootstrapUrl);
    console.log(
      options.keepOpen
        ? "[prepare-browser] Browser remains open until you close it."
        : `[prepare-browser] Complete login or captcha verification. The browser closes automatically after a session is captured (timeout: ${Math.round(options.timeoutMs / 60000)} minutes).`
    );

    const sessionCaptured = await waitForLoginSession({
      flushSnapshot: flushRuntimeSessionSnapshot,
      page,
      timeoutMs: options.timeoutMs,
    });
    if (!sessionCaptured) {
      throw new Error(
        "No usable Douyin session was captured before the login timeout."
      );
    }

    if (options.keepOpen) {
      await context.waitForEvent("close");
      return;
    }

    console.log("[prepare-browser] Login session captured. Closing browser.");
  } finally {
    if (context.pages().length >= 0) {
      try {
        await context.close();
      } catch {
        // noop
      }
    }
  }
}

main().catch((error) => {
  console.error("[prepare-browser] failed", error);
  process.exit(1);
});
