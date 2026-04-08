import {
  containsDouyinLoginPrompt,
  hasUsableDouyinSessionCookies,
} from "../../src/services/douyin/browserSearchService.js";

function trimText(value = "", limit = 500) {
  const safeValue = String(value ?? "");
  if (safeValue.length <= limit) {
    return safeValue;
  }

  return `${safeValue.slice(0, limit)}...[truncated]`;
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

export async function inspectSessionHealth(context, page) {
  const cookies = await context.cookies("https://www.douyin.com");
  const cookieNames = cookies.map((item) => item.name).filter(Boolean);
  const hasSessionCookie = hasUsableDouyinSessionCookies(cookies);

  if (!page || page.isClosed()) {
    return {
      checkedAt: new Date().toISOString(),
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
    checkedAt: new Date().toISOString(),
    pageAvailable: true,
    loginReady: hasSessionCookie && !loginPromptVisible && !verificationRequired,
    hasSessionCookie,
    verificationRequired,
    loginPromptVisible,
    currentUrl,
    title,
    bodyPreview: trimText(bodyText, 500),
    cookieNames,
    loginOverlay,
  };
}

function createHealthFingerprint(health) {
  return JSON.stringify({
    pageAvailable: Boolean(health?.pageAvailable),
    loginReady: Boolean(health?.loginReady),
    hasSessionCookie: Boolean(health?.hasSessionCookie),
    verificationRequired: Boolean(health?.verificationRequired),
    loginPromptVisible: Boolean(health?.loginPromptVisible),
    currentUrl: health?.currentUrl || "",
    overlayText: health?.loginOverlay?.text || "",
  });
}

export function startSessionHealthMonitor({
  context,
  getActivePage,
  captureStore,
  intervalMs = 30000,
  logger = console,
}) {
  let lastFingerprint = "";
  let timer = null;

  const runCheck = async () => {
    const page = getActivePage();
    const health = await inspectSessionHealth(context, page);
    const nextFingerprint = createHealthFingerprint(health);

    if (nextFingerprint !== lastFingerprint) {
      lastFingerprint = nextFingerprint;
      captureStore.append({
        type: "session-health",
        payload: health,
      });

      logger.log(
        `[lab:health] loginReady=${health.loginReady} sessionCookie=${health.hasSessionCookie} verify=${health.verificationRequired} loginPrompt=${health.loginPromptVisible} url=${health.currentUrl || "-"}` // eslint-disable-line max-len
      );
    }

    return health;
  };

  timer = setInterval(() => {
    runCheck().catch((error) => {
      captureStore.append({
        type: "session-health-error",
        payload: {
          message: error.message,
        },
      });
      logger.error("[lab:health] failed", error);
    });
  }, intervalMs);

  timer.unref?.();

  return {
    runCheck,
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
