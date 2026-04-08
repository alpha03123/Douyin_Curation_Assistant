import { env } from "../../config/env.js";
import { ensureDouyinAuth } from "./auth.js";
import { BROWSER_PROFILE_DIR, LAB_PROFILE_DIR } from "./browserProfiles.js";
import {
  hasUsableDouyinSessionCookies,
  inspectPersistentDouyinSession,
  launchPersistentDouyinContext,
  resolveExecutablePath,
  toDouyinBrowserCookies,
} from "./browserSearchService.js";
import { readProfileLock } from "./profileLockService.js";
import { readRuntimeSessionSnapshot } from "./runtimeSessionCacheService.js";

const DEFAULT_TARGET_URL = "https://www.douyin.com/";
const CACHE_TTL_MS = 15_000;
const PROFILE_TARGET_MAP = {
  runtime: BROWSER_PROFILE_DIR,
  lab: LAB_PROFILE_DIR,
};

let cachedMatrix = null;
let cachedAt = 0;
let pendingMatrixPromise = null;

function buildCookieEntries(cookieMap = {}) {
  return Object.entries(cookieMap).map(([name, value]) => ({
    name,
    value,
  }));
}

function buildEnvSessionSnapshot() {
  const cookieString = String(env.dyCookies || "").trim();
  if (!cookieString) {
    return {
      sourceKey: "env",
      sourceType: "shared-env",
      available: false,
      inspected: true,
      browserAvailable: true,
      profileDir: "",
      executablePath: "",
      targetUrl: "",
      loginReady: false,
      hasSessionCookie: false,
      loginPromptVisible: false,
      verificationRequired: false,
      currentUrl: "",
      title: "",
      cookieNames: [],
      cookieString: "",
      canSeedProfiles: false,
    };
  }

  const auth = ensureDouyinAuth(cookieString);
  const cookieNames = Object.keys(auth.cookie);
  const hasSessionCookie = hasUsableDouyinSessionCookies(
    buildCookieEntries(auth.cookie)
  );

  return {
    sourceKey: "env",
    sourceType: "shared-env",
    available: true,
    inspected: true,
    browserAvailable: true,
    profileDir: "",
    executablePath: "",
    targetUrl: "",
    loginReady: hasSessionCookie,
    hasSessionCookie,
    loginPromptVisible: false,
    verificationRequired: false,
    currentUrl: "",
    title: "",
    cookieNames,
    cookieString: auth.cookieString,
    canSeedProfiles: hasSessionCookie,
  };
}

async function buildRuntimeCacheSessionSnapshot() {
  const snapshot = await readRuntimeSessionSnapshot();
  if (!snapshot?.cookieString) {
    return {
      sourceKey: "runtime",
      sourceType: "runtime-cache",
      available: false,
      inspected: false,
      browserAvailable: true,
      profileDir: BROWSER_PROFILE_DIR,
      executablePath: "",
      targetUrl: snapshot?.targetUrl || "",
      loginReady: false,
      hasSessionCookie: false,
      loginPromptVisible: false,
      verificationRequired: false,
      currentUrl: "",
      title: "",
      cookieNames: [],
      cookieString: "",
      canSeedProfiles: false,
      updatedAt: snapshot?.updatedAt || "",
    };
  }

  const auth = ensureDouyinAuth(snapshot.cookieString);
  const cookieNames = Object.keys(auth.cookie);
  const hasSessionCookie = hasUsableDouyinSessionCookies(
    buildCookieEntries(auth.cookie)
  );

  return {
    sourceKey: "runtime",
    sourceType: "runtime-cache",
    available: true,
    inspected: false,
    browserAvailable: true,
    profileDir: BROWSER_PROFILE_DIR,
    executablePath: "",
    targetUrl: snapshot.targetUrl || "",
    loginReady: hasSessionCookie,
    hasSessionCookie,
    loginPromptVisible: false,
    verificationRequired: false,
    currentUrl: "",
    title: "",
    cookieNames,
    cookieString: auth.cookieString,
    canSeedProfiles: hasSessionCookie,
    updatedAt: snapshot.updatedAt || "",
  };
}

async function inspectProfileSessionSource({
  sourceKey,
  profileDir,
  targetUrl = DEFAULT_TARGET_URL,
} = {}) {
  const inspected = await inspectPersistentDouyinSession({
    targetUrl,
    headless: true,
    profileDir,
  });

  return {
    sourceKey,
    sourceType: "profile",
    available: inspected.browserAvailable,
    canSeedProfiles: Boolean(inspected.cookieString),
    ...inspected,
  };
}

function scoreSessionSource(source = {}) {
  let score = 0;

  if (source.loginReady) {
    score += 1_000;
  }

  if (source.hasSessionCookie) {
    score += 250;
  }

  if (!source.verificationRequired) {
    score += 60;
  }

  if (!source.loginPromptVisible) {
    score += 30;
  }

  if (source.cookieString) {
    score += 20;
  }

  if (source.sourceKey === "env") {
    score -= 15;
  }

  return score;
}

function pickPreferredSessionSource(sources = []) {
  const viableSources = sources.filter(
    (item) => item && item.available !== false && item.cookieString
  );

  if (viableSources.length === 0) {
    return null;
  }

  return [...viableSources].sort((left, right) => {
    const scoreDelta = scoreSessionSource(right) - scoreSessionSource(left);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    return String(left.sourceKey || "").localeCompare(String(right.sourceKey || ""));
  })[0];
}

async function buildSessionMatrix(targetUrl = DEFAULT_TARGET_URL) {
  const [runtimeSession, labSession] = await Promise.all([
    inspectProfileSessionSource({
      sourceKey: "runtime",
      profileDir: BROWSER_PROFILE_DIR,
      targetUrl,
    }),
    inspectProfileSessionSource({
      sourceKey: "lab",
      profileDir: LAB_PROFILE_DIR,
      targetUrl,
    }),
  ]);
  const runtimeCacheSession = await buildRuntimeCacheSessionSnapshot();
  const envSession = buildEnvSessionSnapshot();
  const preferredSource = pickPreferredSessionSource([
    runtimeSession,
    runtimeCacheSession,
    labSession,
    envSession,
  ]);

  return {
    targetUrl,
    runtimeSession,
    runtimeCacheSession,
    labSession,
    envSession,
    preferredSource,
    generatedAt: new Date().toISOString(),
  };
}

function buildProfileSnapshot({
  sourceKey,
  profileDir,
  cachedSession = null,
  lockInfo = null,
} = {}) {
  return {
    sourceKey,
    sourceType: cachedSession?.sourceType || "profile",
    available: true,
    browserAvailable:
      cachedSession?.browserAvailable === undefined
        ? true
        : Boolean(cachedSession.browserAvailable),
    profileDir,
    executablePath: cachedSession?.executablePath || "",
    targetUrl: cachedSession?.targetUrl || "",
    inspected: Boolean(cachedSession?.inspected),
    loginReady: Boolean(cachedSession?.loginReady),
    hasSessionCookie: Boolean(cachedSession?.hasSessionCookie),
    loginPromptVisible: Boolean(cachedSession?.loginPromptVisible),
    verificationRequired: Boolean(cachedSession?.verificationRequired),
    currentUrl: cachedSession?.currentUrl || "",
    title: cachedSession?.title || "",
    cookieNames: Array.isArray(cachedSession?.cookieNames) ? cachedSession.cookieNames : [],
    cookieString: cachedSession?.cookieString || "",
    canSeedProfiles: Boolean(cachedSession?.cookieString),
    inspectError: cachedSession?.inspectError || "",
    inUse: Boolean(lockInfo),
    lockInfo: lockInfo || null,
    updatedAt: cachedSession?.updatedAt || "",
  };
}

function cacheSessionMatrix(matrix) {
  cachedMatrix = matrix;
  cachedAt = Date.now();
  return matrix;
}

export function getCachedDouyinSessionMatrix({
  targetUrl = DEFAULT_TARGET_URL,
} = {}) {
  const cacheKey = String(targetUrl || DEFAULT_TARGET_URL);
  if (!cachedMatrix || cachedMatrix.targetUrl !== cacheKey) {
    return null;
  }

  return cachedMatrix;
}

export async function getLightweightDouyinSessionMatrix({
  targetUrl = DEFAULT_TARGET_URL,
} = {}) {
  const cacheKey = String(targetUrl || DEFAULT_TARGET_URL);
  const cached = getCachedDouyinSessionMatrix({ targetUrl: cacheKey });
  const runtimeCacheSession = await buildRuntimeCacheSessionSnapshot();
  const [runtimeLock, labLock] = await Promise.all([
    readProfileLock(BROWSER_PROFILE_DIR),
    readProfileLock(LAB_PROFILE_DIR),
  ]);
  const envSession = buildEnvSessionSnapshot();
  const runtimeSession = buildProfileSnapshot({
    sourceKey: "runtime",
    profileDir: BROWSER_PROFILE_DIR,
    cachedSession:
      cached?.runtimeSession?.cookieString
        ? cached.runtimeSession
        : runtimeCacheSession.cookieString
          ? runtimeCacheSession
          : null,
    lockInfo: runtimeLock,
  });
  const labSession = buildProfileSnapshot({
    sourceKey: "lab",
    profileDir: LAB_PROFILE_DIR,
    cachedSession: cached?.labSession || null,
    lockInfo: labLock,
  });
  const preferredSource = pickPreferredSessionSource([
    runtimeSession,
    runtimeCacheSession,
    labSession,
    envSession,
  ]);

  return {
    targetUrl: cacheKey,
    runtimeSession,
    runtimeCacheSession,
    labSession,
    envSession,
    preferredSource,
    generatedAt: cached?.generatedAt || new Date().toISOString(),
    statusMode: "light",
  };
}

export function clearDouyinSessionMatrixCache() {
  cachedMatrix = null;
  cachedAt = 0;
}

export async function inspectDouyinSessionMatrix({
  targetUrl = DEFAULT_TARGET_URL,
  forceRefresh = false,
} = {}) {
  const cacheKey = String(targetUrl || DEFAULT_TARGET_URL);
  const cacheValid =
    !forceRefresh &&
    cachedMatrix &&
    cachedMatrix.targetUrl === cacheKey &&
    Date.now() - cachedAt < CACHE_TTL_MS;

  if (cacheValid) {
    return cachedMatrix;
  }

  if (!forceRefresh && pendingMatrixPromise) {
    return pendingMatrixPromise;
  }

  pendingMatrixPromise = buildSessionMatrix(cacheKey)
    .then((matrix) => cacheSessionMatrix(matrix))
    .finally(() => {
      pendingMatrixPromise = null;
    });

  return pendingMatrixPromise;
}

export async function inspectSingleDouyinProfileSession({
  profileKey,
  targetUrl = DEFAULT_TARGET_URL,
} = {}) {
  const safeProfileKey = String(profileKey || "").trim();
  const profileDir = PROFILE_TARGET_MAP[safeProfileKey];
  if (!profileDir) {
    const error = new Error(`Unsupported browser session diagnostic profile: ${safeProfileKey}`);
    error.statusCode = 400;
    error.code = "BROWSER_SESSION_PROFILE_UNSUPPORTED";
    throw error;
  }

  const cacheKey = String(targetUrl || DEFAULT_TARGET_URL);
  const cached = getCachedDouyinSessionMatrix({ targetUrl: cacheKey });
  const inspected = await inspectProfileSessionSource({
    sourceKey: safeProfileKey,
    profileDir,
    targetUrl: cacheKey,
  });
  const [runtimeLock, labLock] = await Promise.all([
    readProfileLock(BROWSER_PROFILE_DIR),
    readProfileLock(LAB_PROFILE_DIR),
  ]);
  const envSession = buildEnvSessionSnapshot();
  const runtimeCacheSession = await buildRuntimeCacheSessionSnapshot();
  const runtimeSession =
    safeProfileKey === "runtime"
      ? {
          ...inspected,
          inUse: Boolean(runtimeLock),
          lockInfo: runtimeLock || null,
        }
      : buildProfileSnapshot({
          sourceKey: "runtime",
          profileDir: BROWSER_PROFILE_DIR,
          cachedSession: cached?.runtimeSession || null,
          lockInfo: runtimeLock,
        });
  const labSession =
    safeProfileKey === "lab"
      ? {
          ...inspected,
          inUse: Boolean(labLock),
          lockInfo: labLock || null,
        }
      : buildProfileSnapshot({
          sourceKey: "lab",
          profileDir: LAB_PROFILE_DIR,
          cachedSession: cached?.labSession || null,
          lockInfo: labLock,
        });
  const preferredSource = pickPreferredSessionSource([
    runtimeSession,
    runtimeCacheSession,
    labSession,
    envSession,
  ]);

  return cacheSessionMatrix({
    targetUrl: cacheKey,
    runtimeSession,
    runtimeCacheSession,
    labSession,
    envSession,
    preferredSource,
    generatedAt: new Date().toISOString(),
    statusMode: "deep",
    inspectedProfileKey: safeProfileKey,
  });
}

function shouldRepairProfile(target = {}, source = {}) {
  if (!target?.profileDir || !source?.cookieString) {
    return false;
  }

  if (target.sourceKey === source.sourceKey) {
    return false;
  }

  if (!(source.loginReady || source.hasSessionCookie)) {
    return false;
  }

  if (target.loginReady) {
    return false;
  }

  if (target.available === false || target.browserAvailable === false) {
    return false;
  }

  return true;
}

async function seedProfileWithCookieString(profileDir, cookieString) {
  const executablePath = await resolveExecutablePath();
  if (!executablePath || !profileDir || !cookieString) {
    return {
      synced: false,
      executablePath: executablePath || "",
      reason: "missing_input",
    };
  }

  let context = null;
  try {
    context = await launchPersistentDouyinContext({
      executablePath,
      headless: true,
      profileDir,
    });
    const auth = ensureDouyinAuth(cookieString);
    await context.addCookies(toDouyinBrowserCookies(auth.cookie));

    const page = context.pages()[0] || (await context.newPage());
    await page
      .goto(DEFAULT_TARGET_URL, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      })
      .catch(() => {});
    await page.waitForTimeout(1_200).catch(() => {});

    const cookies = await context.cookies("https://www.douyin.com");
    return {
      synced: hasUsableDouyinSessionCookies(cookies),
      executablePath,
      cookieCount: cookies.length,
    };
  } catch (error) {
    return {
      synced: false,
      executablePath,
      reason: error.message || "Failed to sync Douyin cookies into the profile.",
    };
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

export async function synchronizeDouyinSessionProfiles({
  targetUrl = DEFAULT_TARGET_URL,
  forceRefresh = false,
} = {}) {
  const matrix = await inspectDouyinSessionMatrix({
    targetUrl,
    forceRefresh,
  });
  const preferredSource = matrix.preferredSource;
  const repairs = [];

  if (!preferredSource?.cookieString) {
    return {
      ...matrix,
      repairs,
    };
  }

  for (const target of [matrix.runtimeSession, matrix.labSession]) {
    if (!shouldRepairProfile(target, preferredSource)) {
      continue;
    }

    const repairResult = await seedProfileWithCookieString(
      target.profileDir,
      preferredSource.cookieString
    );

    repairs.push({
      targetKey: target.sourceKey,
      targetProfileDir: target.profileDir,
      sourceKey: preferredSource.sourceKey,
      synced: Boolean(repairResult.synced),
      reason: repairResult.reason || "",
      cookieCount: Number(repairResult.cookieCount || 0),
    });
  }

  if (repairs.length === 0) {
    return {
      ...matrix,
      repairs,
    };
  }

  const refreshedMatrix = await inspectDouyinSessionMatrix({
    targetUrl,
    forceRefresh: true,
  });

  return {
    ...refreshedMatrix,
    repairs,
  };
}

export async function resolvePreferredDouyinCookieSource(options = {}) {
  const synchronizeProfiles =
    options.synchronizeProfiles === undefined
      ? true
      : Boolean(options.synchronizeProfiles);
  const useLightweightMatrix =
    options.useLightweightMatrix === undefined
      ? !synchronizeProfiles
      : Boolean(options.useLightweightMatrix);
  const matrix = synchronizeProfiles
    ? await synchronizeDouyinSessionProfiles(options)
    : useLightweightMatrix
      ? await getLightweightDouyinSessionMatrix(options)
      : await inspectDouyinSessionMatrix(options);
  return {
    ...matrix,
    source: matrix.preferredSource,
  };
}

export async function resolvePreferredDouyinCookieString(options = {}) {
  const { source, ...rest } = await resolvePreferredDouyinCookieSource(options);
  if (source?.cookieString) {
    return {
      cookieString: source.cookieString,
      source,
      matrix: rest,
    };
  }

  const error = new Error(
    "No usable Douyin session is available. Configure DY_COOKIES or complete login in a healthy browser profile first."
  );
  error.statusCode = 500;
  error.code = "DY_COOKIES_MISSING";
  throw error;
}
