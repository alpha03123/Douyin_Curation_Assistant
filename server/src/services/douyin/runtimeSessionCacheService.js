import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { env } from "../../config/env.js";
import { ensureDouyinAuth } from "./auth.js";

const CACHE_PATH = path.resolve(
  env.projectRoot,
  ".runtime",
  "runtime-session-cache.json"
);

async function ensureCacheDir() {
  await mkdir(path.dirname(CACHE_PATH), { recursive: true });
}

export async function writeRuntimeSessionSnapshot({
  cookieString = "",
  storageState = null,
  source = "runtime-browser",
  targetUrl = "",
} = {}) {
  const normalizedCookieString = String(cookieString || "").trim();
  const normalizedStorageState =
    storageState && typeof storageState === "object" ? storageState : null;
  if (!normalizedCookieString && !normalizedStorageState) {
    return null;
  }

  const auth = normalizedCookieString
    ? ensureDouyinAuth(normalizedCookieString)
    : ensureDouyinAuth(
        Array.isArray(normalizedStorageState?.cookies)
          ? normalizedStorageState.cookies
              .filter((item) => item?.name && item?.value !== undefined && item?.value !== null)
              .map((item) => `${item.name}=${item.value}`)
              .join("; ")
          : ""
      );
  const payload = {
    source: String(source || "runtime-browser"),
    targetUrl: String(targetUrl || ""),
    cookieString: auth.cookieString,
    cookieNames: Object.keys(auth.cookie),
    storageState: normalizedStorageState,
    updatedAt: new Date().toISOString(),
  };

  await ensureCacheDir();
  await writeFile(CACHE_PATH, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

export async function readRuntimeSessionSnapshot() {
  try {
    const content = await readFile(CACHE_PATH, "utf8");
    const parsed = JSON.parse(content);
    if (!parsed?.cookieString) {
      return null;
    }

    const auth = ensureDouyinAuth(parsed.cookieString);
    return {
      source: String(parsed.source || "runtime-browser"),
      targetUrl: String(parsed.targetUrl || ""),
      cookieString: auth.cookieString,
      cookieNames: Object.keys(auth.cookie),
      storageState:
        parsed.storageState && typeof parsed.storageState === "object"
          ? parsed.storageState
          : null,
      updatedAt: parsed.updatedAt || "",
    };
  } catch {
    return null;
  }
}

export async function clearRuntimeSessionSnapshot() {
  await rm(CACHE_PATH, { force: true }).catch(() => {});
}

export { CACHE_PATH as RUNTIME_SESSION_CACHE_PATH };
