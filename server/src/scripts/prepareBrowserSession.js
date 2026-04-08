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
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--target-url" && argv[index + 1]) {
      options.targetUrl = String(argv[index + 1] || "").trim() || options.targetUrl;
      index += 1;
    }
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
  let snapshotTimer = null;

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

    await flushRuntimeSessionSnapshot();
    snapshotTimer = setInterval(() => {
      void flushRuntimeSessionSnapshot();
    }, 2500);

    console.log("[prepare-browser] Browser profile directory:", BROWSER_PROFILE_DIR);
    console.log("[prepare-browser] Target page:", options.targetUrl);
    console.log("[prepare-browser] Bootstrap page:", bootstrapUrl);
    console.log(
      "[prepare-browser] Complete login or captcha verification in the opened browser, then close the browser window."
    );

    await context.waitForEvent("close", { timeout: 0 });
  } finally {
    if (snapshotTimer) {
      clearInterval(snapshotTimer);
      snapshotTimer = null;
    }
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
