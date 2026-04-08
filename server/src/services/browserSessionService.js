import path from "node:path";
import { spawn } from "node:child_process";
import { access, mkdir, open, readFile, rm } from "node:fs/promises";
import { env } from "../config/env.js";
import {
  BROWSER_PROFILE_DIR,
  LAB_PROFILE_DIR,
} from "./douyin/browserProfiles.js";
import {
  resolveExecutablePath,
  stopBrowsersUsingProfile,
} from "./douyin/browserSearchService.js";
import { readProfileLock } from "./douyin/profileLockService.js";
import {
  clearDouyinSessionMatrixCache,
  getLightweightDouyinSessionMatrix,
  inspectSingleDouyinProfileSession,
} from "./douyin/sessionCoordinatorService.js";
import { clearRuntimeSessionSnapshot } from "./douyin/runtimeSessionCacheService.js";

const PROFILE_RESET_TARGETS = {
  runtime: {
    profileDir: BROWSER_PROFILE_DIR,
    label: "Runtime browser",
  },
  lab: {
    profileDir: LAB_PROFILE_DIR,
    label: "Audit lab browser",
  },
};

function createHttpError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeTargetUrl(value = "") {
  const safeValue = String(value || "").trim();
  return safeValue || env.actionCaptureTargetUrl;
}

async function checkProfileExists(profileDir) {
  try {
    await access(profileDir);
    return true;
  } catch {
    return false;
  }
}

async function createPrepareBrowserLogFiles() {
  const logDir = path.resolve(env.projectRoot, ".runtime", "logs");
  await mkdir(logDir, { recursive: true });
  const outPath = path.resolve(logDir, "prepare-browser.out.log");
  const errPath = path.resolve(logDir, "prepare-browser.err.log");
  const [outHandle, errHandle] = await Promise.all([
    open(outPath, "w"),
    open(errPath, "w"),
  ]);

  return {
    outPath,
    errPath,
    outHandle,
    errHandle,
  };
}

async function readPrepareBrowserErrorSummary(errPath) {
  try {
    const content = await readFile(errPath, "utf8");
    const trimmed = String(content || "").trim();
    if (!trimmed) {
      return "";
    }

    return trimmed.split(/\r?\n/).slice(-6).join(" ");
  } catch {
    return "";
  }
}

function buildDefaultSession(profileDir = "") {
  return {
    sourceKey: "",
    sourceType: "profile",
    available: true,
    browserAvailable: true,
    profileDir,
    executablePath: "",
    targetUrl: "",
    inspected: false,
    loginReady: false,
    hasSessionCookie: false,
    loginPromptVisible: false,
    verificationRequired: false,
    currentUrl: "",
    title: "",
    cookieNames: [],
    cookieString: "",
    canSeedProfiles: false,
    inspectError: "",
    inUse: false,
    lockInfo: null,
  };
}

function buildStatusSummary({
  executablePath,
  runtimeSession,
  labSession,
  preferredSource,
  statusMode,
  inspectedProfileKey,
} = {}) {
  if (!executablePath) {
    return "本机没有检测到 Edge 或 Chrome。";
  }

  if (
    statusMode === "light" &&
    !runtimeSession?.inspectError &&
    !labSession?.inspectError &&
    !runtimeSession?.inspected &&
    !labSession?.inspected
  ) {
    if (runtimeSession?.sourceType === "runtime-cache" && runtimeSession?.hasSessionCookie) {
      return "当前显示的是轻量状态；系统已捕获 Runtime 浏览器里的最新登录 Cookie，关键词采集会优先使用它。";
    }

    return "当前显示的是轻量状态，不会启动浏览器深检；如需确认真实登录态，请手动执行深度检查。";
  }

  if (runtimeSession?.inUse) {
    return "当前 Runtime Profile 正在被其它任务占用，系统已停止并发读取以避免再次抢占浏览器目录。";
  }

  if (labSession?.inUse) {
    return "当前审核 Lab Profile 正在被其它任务占用，系统已停止并发读取以避免再次抢占浏览器目录。";
  }

  if (statusMode === "deep" && inspectedProfileKey === "runtime") {
    if (runtimeSession?.inspectError) {
      return `Runtime 深度检查失败：${runtimeSession.inspectError}`;
    }
    return "已完成 Runtime Profile 深度检查。";
  }

  if (statusMode === "deep" && inspectedProfileKey === "lab") {
    if (labSession?.inspectError) {
      return `Lab 深度检查失败：${labSession.inspectError}`;
    }
    return "已完成 Lab Profile 深度检查。";
  }

  if (runtimeSession?.inspectError) {
    return `已检测到浏览器，但 runtime 会话检查失败：${runtimeSession.inspectError}。`;
  }

  if (runtimeSession?.loginReady && labSession?.loginReady) {
    return "Runtime 与审核 Lab 会话都已就绪，可以继续采集和执行任务。";
  }

  if (runtimeSession?.loginReady && !labSession?.loginReady) {
    return "Runtime 已就绪，但审核 Lab 仍未就绪。";
  }

  if (!runtimeSession?.loginReady && labSession?.loginReady) {
    return "审核 Lab 已就绪，但 Runtime 仍未就绪。";
  }

  if (runtimeSession?.verificationRequired) {
    return "当前 Runtime 会话需要验证码或遇到风控，请先打开验证浏览器完成处理。";
  }

  if (labSession?.verificationRequired) {
    return "当前审核 Lab 会话需要验证码或遇到风控。";
  }

  if (preferredSource?.sourceKey === "env" && preferredSource?.hasSessionCookie) {
    return "当前没有已就绪的浏览器 Profile，但仍可用 .env 里的 Cookie 作为种子会话。";
  }

  return "Runtime 与审核 Lab 当前都没有确认可用的登录态。";
}

export async function getBrowserSessionStatus(options = {}) {
  const executablePath = await resolveExecutablePath();
  const targetUrl = normalizeTargetUrl(options.targetUrl);
  const deepProfile = String(options.deepProfile || "").trim();
  const [profileExists, labProfileExists, matrix] = await Promise.all([
    checkProfileExists(BROWSER_PROFILE_DIR),
    checkProfileExists(LAB_PROFILE_DIR),
    deepProfile
      ? inspectSingleDouyinProfileSession({
          profileKey: deepProfile,
          targetUrl,
        })
      : getLightweightDouyinSessionMatrix({
          targetUrl,
        }),
  ]);

  const runtimeSession = matrix.runtimeSession || {
    ...buildDefaultSession(BROWSER_PROFILE_DIR),
    sourceKey: "runtime",
  };
  const labSession = matrix.labSession || {
    ...buildDefaultSession(LAB_PROFILE_DIR),
    sourceKey: "lab",
  };
  const preferredSource = matrix.preferredSource || null;
  const statusMode = matrix.statusMode || (deepProfile ? "deep" : "light");
  const inspectedProfileKey = matrix.inspectedProfileKey || deepProfile || "";
  const statusSummary = buildStatusSummary({
    executablePath,
    runtimeSession,
    labSession,
    preferredSource,
    statusMode,
    inspectedProfileKey,
  });

  return {
    browserAvailable: Boolean(executablePath),
    executablePath: executablePath || "",
    profileDir: BROWSER_PROFILE_DIR,
    profileExists,
    labProfileDir: LAB_PROFILE_DIR,
    labProfileExists,
    dyCookiesReady: Boolean(matrix.envSession?.cookieString || env.dyCookies),
    targetUrl,
    ...runtimeSession,
    runtimeSession,
    labSession,
    sharedCookieSession: matrix.envSession,
    statusMode,
    inspectedProfileKey,
    generatedAt: matrix.generatedAt || "",
    preferredSource: preferredSource
      ? {
          sourceKey: preferredSource.sourceKey,
          sourceType: preferredSource.sourceType,
          loginReady: Boolean(preferredSource.loginReady),
          hasSessionCookie: Boolean(preferredSource.hasSessionCookie),
        }
      : null,
    repairs: Array.isArray(matrix.repairs) ? matrix.repairs : [],
    statusSummary,
  };
}

export async function prepareBrowserSession(options = {}) {
  const executablePath = await resolveExecutablePath();
  if (!executablePath) {
    throw createHttpError(
      "No Edge or Chrome executable was found on this machine.",
      500
    );
  }

  const scriptPath = path.resolve(
    env.projectRoot,
    "server",
    "src",
    "scripts",
    "prepareBrowserSession.js"
  );
  const targetUrl = normalizeTargetUrl(options.targetUrl);
  const existingLock = await readProfileLock(BROWSER_PROFILE_DIR);
  if (existingLock) {
    throw createHttpError(
      `Runtime browser profile is currently in use by ${existingLock.owner || "another task"}. Wait for that task to finish before opening the verification browser.`,
      409
    );
  }

  const { outHandle, errHandle, outPath, errPath } = await createPrepareBrowserLogFiles();

  let child = null;
  try {
    child = spawn(process.execPath, [scriptPath, "--target-url", targetUrl], {
      cwd: env.projectRoot,
      detached: false,
      stdio: ["ignore", outHandle.fd, errHandle.fd],
      windowsHide: true,
    });
  } finally {
    await Promise.all([
      outHandle.close().catch(() => {}),
      errHandle.close().catch(() => {}),
    ]);
  }

  const exitedEarly = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 1800);

    function cleanup() {
      clearTimeout(timer);
      child?.removeListener("error", handleError);
      child?.removeListener("exit", handleExit);
    }

    function handleError(error) {
      cleanup();
      reject(error);
    }

    function handleExit(code, signal) {
      cleanup();
      resolve({ code, signal });
    }

    child.once("error", handleError);
    child.once("exit", handleExit);
  });

  if (exitedEarly) {
    const errorSummary = await readPrepareBrowserErrorSummary(errPath);
    throw createHttpError(
      errorSummary ||
        `Runtime browser failed to start${exitedEarly.code !== null ? ` (exit code ${exitedEarly.code})` : ""}${exitedEarly.signal ? `, signal ${exitedEarly.signal}` : ""}.`,
      500
    );
  }

  child.unref?.();

  return {
    launched: true,
    executablePath,
    profileDir: BROWSER_PROFILE_DIR,
    targetUrl,
    logPaths: {
      outPath,
      errPath,
    },
    message:
      "Runtime browser has been opened. Complete login or captcha verification in the opened browser window, close it, then retry the action task.",
  };
}

function assertSafeBrowserProfilePath(profileDir) {
  const runtimeRoot = path.resolve(env.projectRoot, ".runtime");
  const resolvedProfileDir = path.resolve(profileDir);

  if (!resolvedProfileDir.startsWith(runtimeRoot)) {
    throw createHttpError(
      "Refusing to reset browser profile because the target path is outside the project runtime directory.",
      500
    );
  }
}

function resolveProfileResetTarget(profileKey = "runtime") {
  const safeProfileKey = String(profileKey || "runtime").trim().toLowerCase() || "runtime";
  const target = PROFILE_RESET_TARGETS[safeProfileKey];
  if (!target) {
    throw createHttpError(
      `Unsupported browser session profile: ${safeProfileKey}`,
      400
    );
  }

  return {
    profileKey: safeProfileKey,
    ...target,
  };
}

async function stopBrowserProcessesForProfile(profileDir) {
  await stopBrowsersUsingProfile(profileDir);
}

export async function resetBrowserSession(options = {}) {
  const { profileKey, profileDir, label } = resolveProfileResetTarget(
    options.profileKey
  );

  assertSafeBrowserProfilePath(profileDir);
  await stopBrowserProcessesForProfile(profileDir);

  if (profileKey === "runtime") {
    await clearRuntimeSessionSnapshot().catch(() => {});
  }

  clearDouyinSessionMatrixCache();

  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await rm(profileDir, {
        recursive: true,
        force: true,
        maxRetries: 2,
        retryDelay: 300,
      });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }

  if (lastError) {
    throw createHttpError(
      `Failed to reset browser session profile: ${lastError.message}`,
      500
    );
  }

  return {
    reset: true,
    profileKey,
    profileDir,
    message:
      profileKey === "runtime"
        ? `${label} profile has been cleared. Open the login browser again to create a fresh Douyin session.`
        : `${label} profile has been cleared. The next review action run will recreate it and reseed cookies if a healthy session is available.`,
  };
}
