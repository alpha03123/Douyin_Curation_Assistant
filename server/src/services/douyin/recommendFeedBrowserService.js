import {
  containsDouyinLoginPrompt,
  hasUsableDouyinSessionCookies,
  launchPersistentDouyinContext,
  resolveExecutablePath,
  serializePlaywrightCookies,
  toDouyinBrowserCookies,
} from "./browserSearchService.js";
import { ensureDouyinAuth } from "./auth.js";
import { RECOMMEND_PROFILE_DIR } from "./browserProfiles.js";
import { resolvePreferredDouyinCookieString } from "./sessionCoordinatorService.js";

function createHttpError(message, statusCode = 500, code = null, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
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

function normalizeComparableUrl(value = "") {
  const safeValue = String(value || "").trim();
  if (!safeValue) {
    return "";
  }

  try {
    const url = new URL(safeValue);
    url.hash = "";
    const entries = [...url.searchParams.entries()].sort(([leftKey], [rightKey]) =>
      leftKey.localeCompare(rightKey)
    );
    url.search = "";
    for (const [key, itemValue] of entries) {
      url.searchParams.append(key, itemValue);
    }

    return url.toString();
  } catch {
    return safeValue;
  }
}

export function buildRecommendBootstrapUrl(value = "") {
  const safeValue = String(value || "").trim();
  if (!safeValue) {
    return safeValue;
  }

  try {
    const url = new URL(safeValue);
    if (
      url.origin === "https://www.douyin.com" &&
      url.pathname === "/" &&
      url.searchParams.get("recommend") === "1" &&
      !url.searchParams.has("from_nav")
    ) {
      url.searchParams.set("from_nav", "1");
      return url.toString();
    }

    return safeValue;
  } catch {
    return safeValue;
  }
}

function normalizeComparableRecommendUrl(value = "") {
  const safeValue = String(value || "").trim();
  if (!safeValue) {
    return "";
  }

  try {
    const url = new URL(safeValue);
    if (
      url.origin === "https://www.douyin.com" &&
      url.pathname === "/" &&
      url.searchParams.get("recommend") === "1"
    ) {
      url.searchParams.delete("from_nav");
    }

    return normalizeComparableUrl(url.toString());
  } catch {
    return normalizeComparableUrl(safeValue);
  }
}

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, "").trim();
}

function parseVisibleCardText(text = "") {
  const safeText = String(text || "").replace(/\u00a0/g, " ").trim();
  const lines = safeText
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const authorLine = lines.find((item) => item.startsWith("@")) || "";
  const titleLine = lines.find(
    (item) => item && !item.startsWith("@") && !/^\d{2}:\d{2}/.test(item)
  );

  return {
    rawText: safeText.slice(0, 1200),
    lines: lines.slice(0, 20),
    authorGuess: authorLine.replace(/^@/, "").split("·")[0].trim(),
    titleGuess: (titleLine || "").slice(0, 160),
  };
}

function extractAwemeMetaFromHref(href = "") {
  const safeHref = String(href || "").trim();
  const normalizedHref = safeHref.startsWith("//") ? `https:${safeHref}` : safeHref;
  const videoMatched = normalizedHref.match(/\/video\/(\d+)/i);
  if (videoMatched) {
    return {
      awemeId: videoMatched[1],
      itemType: "video",
      href: normalizedHref,
    };
  }

  const noteMatched = normalizedHref.match(/\/note\/(\d+)/i);
  if (noteMatched) {
    return {
      awemeId: noteMatched[1],
      itemType: "image",
      href: normalizedHref,
    };
  }

  const liveMatched =
    normalizedHref.includes("live.douyin.com") ||
    /\/live(\/|$|\?)/i.test(normalizedHref);
  if (liveMatched) {
    return {
      awemeId: "",
      itemType: "live",
      href: normalizedHref,
    };
  }

  return {
    awemeId: "",
    itemType: "unknown",
    href: normalizedHref,
  };
}

function looksLikeLiveCard(item = {}) {
  const text = String(item.text || "");
  if (item.itemType === "live") {
    return true;
  }

  return /正在直播|直播中/i.test(text);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

async function revealFeedInteractionArea(page) {
  const slideList = page.locator('[data-e2e="slideList"]').first();
  const visible = await slideList.isVisible().catch(() => false);
  if (!visible) {
    return false;
  }

  await slideList.hover().catch(() => {});
  await page.waitForTimeout(180);
  return true;
}

export async function inspectRecommendFeedSession(context, page) {
  const cookies = await context.cookies("https://www.douyin.com");
  const hasSessionCookie = hasUsableDouyinSessionCookies(cookies);
  const cookieNames = cookies.map((item) => item.name).filter(Boolean);
  const currentUrl = page.url();
  const title = await page.title().catch(() => "");
  const bodyText = await page.locator("body").innerText({ timeout: 2500 }).catch(() => "");
  const verificationRequired = isVerificationPage({
    url: currentUrl,
    title,
    text: bodyText,
  });
  const loginPromptVisible =
    containsDouyinLoginPrompt(title) || containsDouyinLoginPrompt(bodyText);

  return {
    loginReady: hasSessionCookie && !verificationRequired && !loginPromptVisible,
    hasSessionCookie,
    loginPromptVisible,
    verificationRequired,
    currentUrl,
    title,
    bodyPreview: String(bodyText || "").slice(0, 500),
    cookieNames,
  };
}

export async function inspectAutoplayControl(page) {
  const inspectOnce = async () =>
    page.evaluate(() => {
      const control = document.querySelector('[data-e2e="video-player-auto-play"]');
      if (!control) {
        return {
          found: false,
          visible: false,
          enabled: false,
          text: "",
          rawText: "",
        };
      }

      const rect = control.getBoundingClientRect();
      const style = window.getComputedStyle(control);
      const icon = control.parentElement;
      const rawText = (icon?.textContent || control.textContent || "").trim();
      const normalized = rawText.replace(/\s+/g, "");

      return {
        found: true,
        visible:
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden",
        enabled:
          normalized.includes("\u5173\u95ed\u81ea\u52a8\u8fde\u64ad") ||
          normalized.includes("\u5df2\u5f00\u542f\u8fde\u64ad"),
        text: (control.textContent || "").trim(),
        rawText,
      };
    });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await revealFeedInteractionArea(page).catch(() => {});
    const result = await inspectOnce();
    if (result.found && result.visible) {
      return result;
    }
    await page.waitForTimeout(350);
  }

  return inspectOnce();

  await revealFeedInteractionArea(page).catch(() => {});
  return page.evaluate(() => {
    const control = document.querySelector('[data-e2e="video-player-auto-play"]');
    if (!control) {
      return {
        found: false,
        visible: false,
        enabled: false,
        text: "",
        rawText: "",
      };
    }

    const rect = control.getBoundingClientRect();
    const style = window.getComputedStyle(control);
    const icon = control.parentElement;
    const rawText = (icon?.textContent || control.textContent || "").trim();
    const normalized = rawText.replace(/\s+/g, "");

    return {
      found: true,
      visible:
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden",
      enabled: normalized.includes("关闭自动连播"),
      text: (control.textContent || "").trim(),
      rawText,
    };
  });
}

export async function setAutoplayEnabled(page, desiredEnabled) {
  const initial = await inspectAutoplayControl(page);
  if ((!initial.found || !initial.visible) && desiredEnabled) {
    await page.keyboard.press("k").catch(() => {});
    await page.waitForTimeout(500);

    const retried = await inspectAutoplayControl(page);
    if (retried.found && retried.visible) {
      if (Boolean(retried.enabled) === Boolean(desiredEnabled)) {
        return {
          ...retried,
          toggled: true,
        };
      }

      const retriedControl = page.locator('[data-e2e="video-player-auto-play"]').first();
      await revealFeedInteractionArea(page).catch(() => {});
      await retriedControl.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(800);

      const retriedNext = await inspectAutoplayControl(page);
      return {
        ...retriedNext,
        toggled: true,
      };
    }
  }

  if (!initial.found || !initial.visible) {
    return {
      ...initial,
      toggled: false,
    };
  }

  if (Boolean(initial.enabled) === Boolean(desiredEnabled)) {
    return {
      ...initial,
      toggled: false,
    };
  }

  const control = page.locator('[data-e2e="video-player-auto-play"]').first();
  await revealFeedInteractionArea(page).catch(() => {});
  await control.click({ timeout: 5000 });
  await page.waitForTimeout(800);

  const next = await inspectAutoplayControl(page);
  if (!next.found || !next.visible || Boolean(next.enabled) !== Boolean(desiredEnabled)) {
    throw createHttpError(
      desiredEnabled
        ? "Failed to enable native autoplay control on the recommend page."
        : "Failed to disable native autoplay control on the recommend page.",
      409,
      "RECOMMEND_AUTOPLAY_STATE_MISMATCH",
      {
        desiredEnabled: Boolean(desiredEnabled),
        initial,
        next,
      }
    );
  }

  return {
    ...next,
    toggled: true,
  };
}

export async function openRecommendFeedBrowserSession(options = {}) {
  await resolvePreferredDouyinCookieString({
    targetUrl: options.targetUrl,
    synchronizeProfiles: false,
  }).catch(() => null);

  const executablePath = await resolveExecutablePath();
  if (!executablePath) {
    throw createHttpError(
      "No Edge or Chrome executable was found on this machine.",
      500,
      "BROWSER_EXECUTABLE_MISSING"
    );
  }

  const context = await launchPersistentDouyinContext({
    executablePath,
    headless: Boolean(options.headless),
    profileDir: RECOMMEND_PROFILE_DIR,
    lockOwner: "recommend-feed",
  });

  try {
    const bootstrapUrl = buildRecommendBootstrapUrl(options.targetUrl);
    const page = context.pages()[0] || (await context.newPage());
    const existingCookies = await context.cookies("https://www.douyin.com");
    if (!hasUsableDouyinSessionCookies(existingCookies)) {
      const preferred = await resolvePreferredDouyinCookieString({
        targetUrl: options.targetUrl,
        synchronizeProfiles: false,
      }).catch(() => null);

      if (preferred?.cookieString) {
        const auth = ensureDouyinAuth(preferred.cookieString);
        await context.addCookies(toDouyinBrowserCookies(auth.cookie));
      }
    }

    await page.goto(bootstrapUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(4000);

    const currentUrl = page.url();
    if (
      normalizeComparableRecommendUrl(currentUrl) !==
      normalizeComparableRecommendUrl(options.targetUrl)
    ) {
      throw createHttpError(
        "Recommend feed target page redirected to a different URL.",
        409,
        "RECOMMEND_TARGET_REDIRECTED",
        {
          targetUrl: options.targetUrl,
          bootstrapUrl,
          currentUrl,
        }
      );
    }

    const sessionHealth = await inspectRecommendFeedSession(context, page);
    const autoplayControl = await inspectAutoplayControl(page).catch(() => ({
      found: false,
      visible: false,
      enabled: false,
      text: "",
      rawText: "",
    }));

    return {
      context,
      page,
      executablePath,
      sessionHealth,
      autoplayControl,
      bootstrapUrl,
      currentUrl,
      profileDir: RECOMMEND_PROFILE_DIR,
    };
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}

export async function getContextCookieString(context) {
  const cookies = await context.cookies("https://www.douyin.com");
  return serializePlaywrightCookies(cookies);
}

async function collectFeedModeCards(page) {
  const feedItems = await page.evaluate(() => {
    const nodes = [
      ...document.querySelectorAll('[data-e2e="feed-active-video"], [data-e2e="feed-video"]'),
    ];

    return nodes
      .map((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.width <= 120 || rect.height <= 120) {
          return null;
        }

        const infoRoot = node.querySelector('[data-e2e="video-info"]');
        const nicknameNode = node.querySelector('[data-e2e="feed-video-nickname"]');
        const descNode = node.querySelector('[data-e2e="video-desc"]');
        const profileNode = node.querySelector('[data-e2e="video-avatar"]');
        const videoNode = node.querySelector("video");
        const liveStatusText = [...node.querySelectorAll(".time-live-tag, [data-e2e*='live'], [class*='live']")]
          .map((item) => {
            const rect = item.getBoundingClientRect();
            const style = window.getComputedStyle(item);
            if (
              rect.width <= 0 ||
              rect.height <= 0 ||
              style.display === "none" ||
              style.visibility === "hidden"
            ) {
              return "";
            }

            return (item.textContent || "").trim();
          })
          .filter(Boolean)
          .join(" ");
        const rawText = (infoRoot?.textContent || node.textContent || "").trim();
        const parsedText = (() => {
          const safeText = rawText.replace(/\u00a0/g, " ").trim();
          const lines = safeText
            .split(/\n+/)
            .map((item) => item.trim())
            .filter(Boolean);
          return {
            rawText: safeText.slice(0, 1200),
            lines: lines.slice(0, 20),
          };
        })();

        return {
          feedKind: node.getAttribute("data-e2e") || "",
          awemeId:
            node.getAttribute("data-e2e-vid") ||
            (typeof node.className === "string"
              ? node.className.match(/video_(\d+)/)?.[1] || ""
              : ""),
          href:
            node.getAttribute("data-e2e-vid")
              ? `https://www.douyin.com/video/${node.getAttribute("data-e2e-vid")}`
              : "",
          text: parsedText.rawText,
          lines: parsedText.lines,
          titleGuess: (descNode?.textContent || "").trim().slice(0, 160),
          authorGuess: ((nicknameNode?.textContent || "").trim() || "")
            .replace(/^@/, "")
            .split("·")[0]
            .trim(),
          profileHref: profileNode?.getAttribute("href") || "",
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          visibleArea: rect.width * rect.height,
          className: typeof node.className === "string" ? node.className : "",
          hasLiveHref:
            /live\.douyin\.com|\/live(\/|$|\?)/i.test(String(profileNode?.getAttribute("href") || "")) ||
            /live\.douyin\.com|\/live(\/|$|\?)/i.test(String(rawText)),
          hasLiveStatusText: /正在直播|直播中|开播中/i.test(String(liveStatusText || rawText)),
          videoState: videoNode
            ? {
                paused: Boolean(videoNode.paused),
                currentTime: Number(videoNode.currentTime || 0),
                duration: Number(videoNode.duration || 0),
                ended: Boolean(videoNode.ended),
              }
            : {
                paused: false,
                currentTime: 0,
                duration: 0,
                ended: false,
              },
        };
      })
      .filter(Boolean);
  });

  return feedItems
    .filter((item) => item.feedKind === "feed-active-video")
    .map((item, index) => ({
      visibleIndex: index,
      href: item.href,
      awemeId: item.awemeId,
      itemType: "video",
      isLive: /正在直播|直播中/i.test(`${item.text} ${item.titleGuess}`),
      text: item.text,
      lines: item.lines || [],
      authorGuess: item.authorGuess || "",
      titleGuess: item.titleGuess || "",
      top: item.top,
      left: item.left,
      width: item.width,
      height: item.height,
      visibleArea: item.visibleArea,
      className: item.className,
      hasLiveHref: item.hasLiveHref,
      hasLiveStatusText: item.hasLiveStatusText,
      advanceMethod: "slidelist-wheel",
      profileHref: item.profileHref || "",
      videoState: item.videoState || {
        paused: false,
        currentTime: 0,
        duration: 0,
        ended: false,
      },
    }));
}

async function collectFallbackCards(page) {
  const items = await page.evaluate(() => {
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const candidates = [
      ...document.querySelectorAll(
        '[href*="/video/"], [href*="/note/"], [href*="live.douyin.com"], [href*="/live"]'
      ),
    ];

    return candidates
      .map((item) => {
        const rect = item.getBoundingClientRect();
        const visibleWidth = Math.max(
          0,
          Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0)
        );
        const visibleHeight = Math.max(
          0,
          Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0)
        );
        const visibleArea = visibleWidth * visibleHeight;
        return {
          href: item.getAttribute("href") || "",
          text: (item.textContent || "").trim(),
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          visibleArea,
          className: typeof item.className === "string" ? item.className : "",
        };
      })
      .filter(
        (item) => item.width > 100 && item.height > 100 && item.visibleArea > 20000
      )
      .sort((left, right) => left.top - right.top || left.left - right.left)
      .slice(0, 30);
  });

  return items.map((item, index) => {
    const meta = extractAwemeMetaFromHref(item.href);
    const parsedText = parseVisibleCardText(item.text);
    return {
      visibleIndex: index,
      href: meta.href,
      awemeId: meta.awemeId,
      itemType: meta.itemType,
      isLive: looksLikeLiveCard({
        itemType: meta.itemType,
        text: item.text,
      }),
      text: parsedText.rawText,
      lines: parsedText.lines,
      authorGuess: parsedText.authorGuess,
      titleGuess: parsedText.titleGuess,
      top: item.top,
      left: item.left,
      width: item.width,
      height: item.height,
      visibleArea: item.visibleArea,
      className: item.className,
      advanceMethod: "scroll",
      videoState: {
        paused: false,
        currentTime: 0,
        duration: 0,
        ended: false,
      },
    };
  });
}

export async function collectVisibleFeedCards(page) {
  const feedCards = await collectFeedModeCards(page);
  if (feedCards.length > 0) {
    return feedCards;
  }

  return collectFallbackCards(page);
}

export async function getActiveFeedCard(page) {
  const cards = await collectVisibleFeedCards(page);
  return cards[0] || null;
}

export function buildNativeAutoplayTimeoutMs(card, fallbackMs = 90_000) {
  const duration = Number(card?.videoState?.duration || 0);
  const currentTime = Number(card?.videoState?.currentTime || 0);
  if (Number.isFinite(duration) && duration > 0) {
    const remainingMs = Math.max(0, (duration - currentTime) * 1000);
    return clamp(Math.round(remainingMs + 4000), 8000, 15 * 60 * 1000);
  }

  return fallbackMs;
}

export async function waitForFeedTransition(
  page,
  { previousAwemeId, timeoutMs = 30_000, pollMs = 500 } = {}
) {
  const startedAt = Date.now();
  let lastCard = await getActiveFeedCard(page);
  if (lastCard?.awemeId && lastCard.awemeId !== previousAwemeId) {
    return {
      changed: true,
      previousAwemeId,
      nextAwemeId: lastCard.awemeId,
      card: lastCard,
      waitedMs: 0,
    };
  }

  while (Date.now() - startedAt < timeoutMs) {
    await page.waitForTimeout(pollMs);
    lastCard = await getActiveFeedCard(page);
    if (lastCard?.awemeId && lastCard.awemeId !== previousAwemeId) {
      return {
        changed: true,
        previousAwemeId,
        nextAwemeId: lastCard.awemeId,
        card: lastCard,
        waitedMs: Date.now() - startedAt,
      };
    }
  }

  return {
    changed: false,
    previousAwemeId,
    nextAwemeId: lastCard?.awemeId || "",
    card: lastCard || null,
    waitedMs: Date.now() - startedAt,
  };
}

export async function advanceRecommendFeed(page) {
  const slideList = page.locator('[data-e2e="slideList"]').first();
  const slideListVisible = await slideList.isVisible().catch(() => false);
  if (slideListVisible) {
    let beforeAwemeId = await page.evaluate(() => {
      return (
        document.querySelector('[data-e2e="feed-active-video"]')?.getAttribute(
          "data-e2e-vid"
        ) || ""
      );
    });

    await slideList.hover().catch(() => {});
    if (!beforeAwemeId) {
      await page.waitForTimeout(400);
      beforeAwemeId = await page.evaluate(() => {
        return (
          document.querySelector('[data-e2e="feed-active-video"]')?.getAttribute(
            "data-e2e-vid"
          ) || ""
        );
      });

      if (beforeAwemeId) {
        return {
          advanced: true,
          mode: "slidelist-activate",
          beforeAwemeId: "",
          afterAwemeId: beforeAwemeId,
        };
      }
    }

    const tryReadAfter = async (mode) => {
      const afterAwemeId = await page.evaluate(() => {
        return (
          document.querySelector('[data-e2e="feed-active-video"]')?.getAttribute(
            "data-e2e-vid"
          ) || ""
        );
      });

      if (afterAwemeId && afterAwemeId !== beforeAwemeId) {
        return {
          advanced: true,
          mode,
          beforeAwemeId,
          afterAwemeId,
        };
      }

      return null;
    };

    await page.mouse.wheel(0, 1400);
    await page.waitForTimeout(1600);
    let switched = await tryReadAfter("slidelist-wheel");
    if (switched) {
      return switched;
    }

    await page.mouse.wheel(0, 2200);
    await page.waitForTimeout(1600);
    switched = await tryReadAfter("slidelist-wheel-large");
    if (switched) {
      return switched;
    }

    await page.keyboard.press("PageDown").catch(() => {});
    await page.waitForTimeout(1400);
    switched = await tryReadAfter("slidelist-pagedown");
    if (switched) {
      return switched;
    }

    await page.keyboard.press("ArrowDown").catch(() => {});
    await page.waitForTimeout(1400);
    switched = await tryReadAfter("slidelist-arrowdown");
    if (switched) {
      return switched;
    }
  }

  const result = await page.evaluate(() => {
    const candidates = [...document.querySelectorAll("*")]
      .map((item) => {
        const style = window.getComputedStyle(item);
        const cardCount = item.querySelectorAll
          ? item.querySelectorAll(
              '[href*="/video/"], [href*="/note/"], [href*="live.douyin.com"], [href*="/live"]'
            ).length
          : 0;
        return {
          item,
          cardCount,
          scrollHeight: item.scrollHeight,
          clientHeight: item.clientHeight,
          overflowY: style.overflowY,
        };
      })
      .filter(
        (entry) =>
          entry.cardCount >= 2 &&
          entry.clientHeight > 200 &&
          entry.scrollHeight > entry.clientHeight + 120
      )
      .sort(
        (left, right) =>
          right.cardCount - left.cardCount ||
          right.scrollHeight - left.scrollHeight ||
          right.clientHeight - left.clientHeight
      );

    if (candidates.length > 0) {
      const target = candidates[0].item;
      const before = target.scrollTop;
      const delta = Math.max(260, Math.round(target.clientHeight * 0.8));
      target.scrollTop = Math.min(target.scrollHeight, before + delta);
      return {
        advanced: target.scrollTop !== before,
        mode: "container-scroll",
        before,
        after: target.scrollTop,
        delta,
      };
    }

    const scrollingElement = document.scrollingElement || document.documentElement;
    const before = scrollingElement.scrollTop;
    const delta = Math.max(260, Math.round(window.innerHeight * 0.8));
    scrollingElement.scrollTop = Math.min(
      scrollingElement.scrollHeight,
      before + delta
    );

    return {
      advanced: scrollingElement.scrollTop !== before,
      mode: "document-scroll",
      before,
      after: scrollingElement.scrollTop,
      delta,
    };
  });

  await page.waitForTimeout(2200);
  return result;
}

export async function closeRecommendFeedModal(page) {
  const currentUrl = page.url();
  const url = new URL(currentUrl);
  if (!url.searchParams.has("modal_id")) {
    return {
      closed: false,
      currentUrl,
    };
  }

  url.searchParams.delete("modal_id");
  await page.goto(url.toString(), {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(1500);

  return {
    closed: true,
    currentUrl: page.url(),
  };
}
