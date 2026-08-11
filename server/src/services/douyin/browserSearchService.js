import path from "node:path";
import { execFile } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";
import { env } from "../../config/env.js";
import { DEFAULT_USER_AGENT } from "./headers.js";
import { acquireProfileLock } from "./profileLockService.js";
import { readRuntimeSessionSnapshot } from "./runtimeSessionCacheService.js";
import { spliceUrl } from "./signature.js";
import { BROWSER_PROFILE_DIR } from "./browserProfiles.js";

export { BROWSER_PROFILE_DIR } from "./browserProfiles.js";

function collectBrowserCandidatePaths() {
  const installRoots = [
    process.env["ProgramFiles(x86)"],
    process.env.ProgramFiles,
    process.env.LOCALAPPDATA,
  ].filter(Boolean);

  const candidatePaths = [
    process.env.ACTION_BROWSER_EXECUTABLE,
    process.env.BROWSER_EXECUTABLE_PATH,
    ...installRoots.flatMap((rootDir) => [
      path.join(rootDir, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(rootDir, "Google", "Chrome", "Application", "chrome.exe"),
    ]),
  ]
    .filter((candidatePath) => candidatePath && candidatePath.trim())
    .map((candidatePath) => path.normalize(candidatePath.trim()));

  return [...new Set(candidatePaths)];
}

const BROWSER_CANDIDATE_PATHS = collectBrowserCandidatePaths();
const DEFAULT_PERSISTENT_CONTEXT_ARGS = [
  "--disable-gpu",
  "--disable-gpu-compositing",
  "--disable-backgrounding-occluded-windows",
  "--disable-features=CalculateNativeWinOcclusion",
  "--no-first-run",
  "--no-default-browser-check",
];

function execFileAsync(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || stdout || error.message));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

export const DOUYIN_SESSION_COOKIE_NAMES = [
  "sessionid",
  "sessionid_ss",
  "sid_tt",
  "uid_tt",
  "sid_guard",
];

const LOGIN_PROMPTS = [
  "\u767b\u5f55\u540e\u514d\u8d39\u7545\u4eab\u9ad8\u6e05\u89c6\u9891",
  "\u7acb\u5373\u767b\u5f55",
  "\u626b\u7801\u767b\u5f55",
  "\u8bf7\u5148\u767b\u5f55",
  "\u767b\u5f55\u540e\u5373\u53ef\u70b9\u8d5e",
  "\u767b\u5f55\u540e\u5373\u53ef\u6536\u85cf",
  "\u767b\u5f55\u540e\u5373\u53ef\u53d1\u8868\u8bc4\u8bba",
];

export async function resolveExecutablePath() {
  for (const candidatePath of BROWSER_CANDIDATE_PATHS) {
    try {
      await access(candidatePath);
      return candidatePath;
    } catch {
      continue;
    }
  }

  return "";
}

export async function stopBrowsersUsingProfile(
  profileDir = BROWSER_PROFILE_DIR
) {
  if (process.platform !== "win32") {
    return { stopped: false };
  }

  const escapedProfileDir = String(profileDir || "").replace(/\\/g, "\\\\");
  const command = [
    "-NoProfile",
    "-Command",
    [
      `$target = '${escapedProfileDir}';`,
      "$items = Get-CimInstance Win32_Process |",
      "Where-Object {",
      "  ($_.Name -eq 'msedge.exe' -or $_.Name -eq 'chrome.exe') -and",
      "  $_.CommandLine -like \"*$target*\"",
      "};",
      "$stopped = @();",
      "foreach ($item in $items) {",
      "  Stop-Process -Id $item.ProcessId -Force -ErrorAction SilentlyContinue;",
      "  $stopped += $item.ProcessId;",
      "}",
      "$stopped | ConvertTo-Json -Compress",
    ].join(" "),
  ];

  try {
    const { stdout } = await execFileAsync("powershell", command);
    const parsed = stdout?.trim() ? JSON.parse(stdout.trim()) : [];
    const processIds = Array.isArray(parsed)
      ? parsed
      : parsed === null || parsed === undefined
        ? []
        : [parsed];

    return {
      stopped: processIds.length > 0,
      processIds,
    };
  } catch {
    return {
      stopped: false,
      processIds: [],
    };
  }
}

export function toDouyinBrowserCookies(cookieMap = {}) {
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

export function serializePlaywrightCookies(cookies = []) {
  return cookies
    .filter((item) => item?.name && item?.value !== undefined && item?.value !== null)
    .map((item) => `${item.name}=${item.value}`)
    .join("; ");
}

export function hasUsableDouyinSessionCookies(cookies = []) {
  const cookieNames = new Set(cookies.map((item) => item?.name).filter(Boolean));
  return DOUYIN_SESSION_COOKIE_NAMES.some((name) => cookieNames.has(name));
}

export function containsDouyinLoginPrompt(text = "") {
  const safeText = String(text || "");
  return LOGIN_PROMPTS.some((prompt) => safeText.includes(prompt));
}

function isVerificationPage({ url, title, html }) {
  return (
    url.includes("captcha") ||
    url.includes("verify") ||
    title.includes("\u9a8c\u8bc1\u7801") ||
    html.includes("\u9a8c\u8bc1\u7801\u4e2d\u95f4\u9875") ||
    html.includes("verify_check") ||
    html.includes("secsdk-captcha")
  );
}

async function collectVisibleSearchItems(page, limit) {
  const items = await page.evaluate((maxItems) => {
    const seen = new Set();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    return [...document.querySelectorAll('a[href*="/video/"], a[href*="/note/"]')]
      .map((anchor) => {
        const href = anchor.href || "";
        const matched = href.match(/\/(video|note)\/(\d+)/i);
        if (!matched || seen.has(matched[2])) {
          return null;
        }

        const rect = anchor.getBoundingClientRect();
        const visible =
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < viewportHeight &&
          rect.left < viewportWidth;
        if (!visible) {
          return null;
        }

        seen.add(matched[2]);
        const card = anchor.closest("li, [data-e2e], [class*='card'], [class*='item']") || anchor;
        return {
          awemeId: matched[2],
          awemeType: matched[1].toLowerCase() === "note" ? 68 : 0,
          text: (card.innerText || anchor.innerText || "").trim().slice(0, 500),
        };
      })
      .filter(Boolean)
      .slice(0, maxItems);
  }, limit);

  return items.map((item) => ({
    aweme_info: {
      aweme_id: item.awemeId,
      aweme_type: item.awemeType,
      desc: item.text,
      author: {},
    },
  }));
}

function createDomSearchPayload(items) {
  return {
    status_code: 0,
    data: items,
    has_more: 0,
    source: "visible-dom",
  };
}

function mergePersistentContextArgs(args = []) {
  return [...new Set([...DEFAULT_PERSISTENT_CONTEXT_ARGS, ...(args || [])])];
}

function buildProfileLockKey(profileDir = BROWSER_PROFILE_DIR) {
  return path.resolve(profileDir || BROWSER_PROFILE_DIR);
}

export async function launchPersistentDouyinContext({
  executablePath,
  headless,
  profileDir = BROWSER_PROFILE_DIR,
  locale = "zh-CN",
  userAgent = DEFAULT_USER_AGENT,
  viewport = { width: 1707, height: 960 },
  args = [],
  lockKey,
  lockOwner,
}) {
  const resolvedProfileDir = path.resolve(profileDir || BROWSER_PROFILE_DIR);
  await mkdir(resolvedProfileDir, { recursive: true });

  let profileLock = null;
  try {
    profileLock = await acquireProfileLock({
      lockKey: lockKey || buildProfileLockKey(resolvedProfileDir),
      owner:
        lockOwner ||
        `persistent-context:${path.basename(resolvedProfileDir) || "browser-profile"}`,
      profileDir: resolvedProfileDir,
    });

    const context = await chromium.launchPersistentContext(resolvedProfileDir, {
      executablePath,
      headless,
      locale,
      userAgent,
      viewport,
      args: mergePersistentContextArgs(args),
    });

    let released = false;
    const releaseLock = async () => {
      if (!released) {
        released = true;
        await profileLock?.release().catch(() => {});
      }
    };

    context.on?.("close", () => {
      void releaseLock();
    });

    const originalClose = context.close.bind(context);
    context.close = async (...closeArgs) => {
      try {
        return await originalClose(...closeArgs);
      } finally {
        await releaseLock();
      }
    };

    return context;
  } catch (error) {
    await profileLock?.release().catch(() => {});
    throw error;
  }
}

export async function readPersistentBrowserCookieString({
  targetUrl = "https://www.douyin.com/video/7604471631310035697",
  headless = true,
  profileDir = BROWSER_PROFILE_DIR,
  userAgent = DEFAULT_USER_AGENT,
  viewport = { width: 1707, height: 960 },
  args = [],
} = {}) {
  const executablePath = await resolveExecutablePath();
  if (!executablePath) {
    return "";
  }

  const context = await launchPersistentDouyinContext({
    executablePath,
    headless,
    profileDir,
    userAgent,
    viewport,
    args,
  });

  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(1500);

    const cookies = await context.cookies("https://www.douyin.com");
    return serializePlaywrightCookies(cookies);
  } finally {
    await context.close().catch(() => {});
  }
}

export async function readActiveBrowserCookieString(
  targetUrl = "https://www.douyin.com/video/7604471631310035697"
) {
  return readPersistentBrowserCookieString({
    targetUrl,
    headless: true,
    profileDir: BROWSER_PROFILE_DIR,
  });
}

export async function inspectPersistentDouyinSession({
  targetUrl = "https://www.douyin.com/",
  headless = true,
  profileDir = BROWSER_PROFILE_DIR,
  userAgent = DEFAULT_USER_AGENT,
  viewport = { width: 1707, height: 960 },
  args = [],
  waitMs = 1800,
} = {}) {
  const executablePath = await resolveExecutablePath();
  if (!executablePath) {
    return {
      browserAvailable: false,
      executablePath: "",
      profileDir,
      inspected: false,
      loginReady: false,
      cookieString: "",
    };
  }

  let context = null;

  try {
    context = await launchPersistentDouyinContext({
      executablePath,
      headless,
      profileDir,
      userAgent,
      viewport,
      args,
      lockOwner: `inspect:${path.basename(profileDir || BROWSER_PROFILE_DIR)}`,
    });

    const page = context.pages()[0] || (await context.newPage());
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(waitMs);

    const cookies = await context.cookies("https://www.douyin.com");
    const hasSessionCookie = hasUsableDouyinSessionCookies(cookies);
    const title = await page.title().catch(() => "");
    const currentUrl = page.url();
    const bodyText = await page.locator("body").innerText({ timeout: 2500 }).catch(() => "");
    const verificationRequired = isVerificationPage({
      url: currentUrl,
      title,
      html: bodyText,
    });
    const loginPromptVisible =
      containsDouyinLoginPrompt(title) || containsDouyinLoginPrompt(bodyText);

    return {
      browserAvailable: true,
      executablePath,
      profileDir,
      inspected: true,
      loginReady: hasSessionCookie && !loginPromptVisible && !verificationRequired,
      hasSessionCookie,
      loginPromptVisible,
      verificationRequired,
      currentUrl,
      title,
      targetUrl,
      cookieNames: cookies.map((item) => item.name).filter(Boolean),
      cookieString: serializePlaywrightCookies(cookies),
    };
  } catch (error) {
    if (error?.code === "BROWSER_PROFILE_LOCKED") {
      return {
        browserAvailable: true,
        executablePath,
        profileDir,
        inspected: false,
        loginReady: false,
        hasSessionCookie: false,
        loginPromptVisible: false,
        verificationRequired: false,
        currentUrl: "",
        title: "",
        inspectError: error.message || "Browser profile is currently in use.",
        targetUrl,
        cookieString: "",
        inUse: true,
        lockInfo: error.details?.existingLock || null,
      };
    }

    return {
      browserAvailable: true,
      executablePath,
      profileDir,
      inspected: false,
      loginReady: false,
      hasSessionCookie: false,
      loginPromptVisible: false,
      verificationRequired: false,
      currentUrl: "",
      title: "",
      inspectError: error.message || "Failed to inspect browser session.",
      targetUrl,
      cookieString: "",
    };
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

export async function searchGeneralWorkPageInBrowser({
  auth,
  referer,
  params,
  verifyCheckErrorFactory,
  httpErrorFactory,
}) {
  const executablePath = await resolveExecutablePath();
  if (!executablePath) {
    throw httpErrorFactory(
      "No Edge or Chrome executable was found for browser discovery fallback.",
      500
    );
  }

  let browser = null;
  let context = null;

  try {
    browser = await chromium.launch({
      executablePath,
      headless: env.searchBrowserHeadless,
    });
    const runtimeSnapshot = await readRuntimeSessionSnapshot().catch(() => null);
    context = await browser.newContext({
      locale: "zh-CN",
      storageState: runtimeSnapshot?.storageState || undefined,
      userAgent: DEFAULT_USER_AGENT,
      viewport: { width: 1707, height: 960 },
    });

    const existingCookies = await context.cookies("https://www.douyin.com");
    if (!hasUsableDouyinSessionCookies(existingCookies)) {
      await context.addCookies(toDouyinBrowserCookies(auth.cookie));
    }
    const page = await context.newPage();
    const desiredCount = Math.max(1, Math.min(Number(params?.count) || 10, 50));
    const payloadHits = [];
    let lastResponseAt = 0;

    page.on("response", async (response) => {
      const url = response.url();
      if (!url.includes("/aweme/v1/web/general/search/single/")) {
        return;
      }

      try {
        const text = await response.text();
        const payload = JSON.parse(text);
        payloadHits.push({
          status: response.status(),
          payload,
          url,
        });
        lastResponseAt = Date.now();
      } catch {
        // ignore malformed network payloads
      }
    });

    await page.goto(referer, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(1500);

    const pageTitle = await page.title();
    const pageHtml = await page.content();
    if (
      isVerificationPage({
        url: page.url(),
        title: pageTitle,
        html: pageHtml,
      })
    ) {
      throw verifyCheckErrorFactory({
        search_nil_info: {
          search_nil_type: "verify_check",
          search_nil_item: "verify_check",
        },
        fromBrowserPage: true,
      });
    }
    const startedAt = Date.now();
    while (Date.now() - startedAt < 20_000) {
      const visibleItems = await collectVisibleSearchItems(page, desiredCount);
      if (visibleItems.length > 0) {
        return createDomSearchPayload(visibleItems);
      }

      const aggregatedItems = [];
      let lastPayload = null;

      for (const hit of payloadHits) {
        const payload = hit.payload;
        if (payload?.search_nil_info?.search_nil_type === "verify_check") {
          throw verifyCheckErrorFactory(payload);
        }

        if (payload?.status_code === 0) {
          lastPayload = payload;
          const items = Array.isArray(payload?.data) ? payload.data : [];
          for (const item of items) {
            const awemeId = String(item?.aweme_info?.aweme_id || "");
            if (!awemeId) {
              continue;
            }

            if (!aggregatedItems.some((existing) => String(existing?.aweme_info?.aweme_id || "") === awemeId)) {
              aggregatedItems.push(item);
            }
          }
        }
      }

      if (lastPayload && aggregatedItems.length >= desiredCount) {
        return {
          ...lastPayload,
          data: aggregatedItems.slice(0, desiredCount),
          has_more: aggregatedItems.length > desiredCount ? 1 : lastPayload?.has_more ?? 0,
        };
      }

      if (lastPayload && aggregatedItems.length > 0 && Date.now() - lastResponseAt > 2500) {
        return {
          ...lastPayload,
          data: aggregatedItems,
          has_more: lastPayload?.has_more ?? 0,
        };
      }

      await page.mouse.wheel(0, 1800).catch(() => {});
      await page.waitForTimeout(1200);
    }

    throw httpErrorFactory(
      "Browser fallback search did not receive any usable result payload from the search page.",
      502
    );
  } catch (error) {
    throw error;
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}
