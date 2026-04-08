import path from "node:path";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { env } from "../../config/env.js";

const LOCK_DIR = path.resolve(env.projectRoot, ".runtime", "profile-locks");

function createHttpError(message, statusCode = 500, code = null, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function sanitizeKey(value = "") {
  return String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

function buildLockPath(lockKey) {
  const safeName = sanitizeKey(lockKey || "default-profile");
  return path.resolve(LOCK_DIR, `${safeName}.lock.json`);
}

async function ensureLockDir() {
  await mkdir(LOCK_DIR, { recursive: true });
}

async function readLockInfo(lockPath) {
  try {
    const content = await readFile(lockPath, "utf8");
    return {
      lockInfo: JSON.parse(content),
      corrupted: false,
    };
  } catch {
    return {
      lockInfo: null,
      corrupted: true,
    };
  }
}

function isPidAlive(pid) {
  const safePid = Number(pid);
  if (!Number.isInteger(safePid) || safePid <= 0) {
    return false;
  }

  try {
    process.kill(safePid, 0);
    return true;
  } catch {
    return false;
  }
}

async function clearStaleLock(lockPath, lockInfo) {
  if (lockInfo?.pid && isPidAlive(lockInfo.pid)) {
    return false;
  }

  await rm(lockPath, { force: true }).catch(() => {});
  return true;
}

export async function readProfileLock(lockKey) {
  await ensureLockDir();
  const lockPath = buildLockPath(lockKey);
  const { lockInfo, corrupted } = await readLockInfo(lockPath);
  if (corrupted) {
    await rm(lockPath, { force: true }).catch(() => {});
    return null;
  }

  if (!lockInfo) {
    return null;
  }

  const stale = await clearStaleLock(lockPath, lockInfo);
  if (stale) {
    return null;
  }

  return {
    ...lockInfo,
    lockPath,
  };
}

export async function acquireProfileLock({
  lockKey,
  owner = "unknown",
  profileDir = "",
} = {}) {
  if (!lockKey) {
    throw createHttpError(
      "Profile lock key is required.",
      500,
      "BROWSER_PROFILE_LOCK_KEY_MISSING"
    );
  }

  await ensureLockDir();
  const lockPath = buildLockPath(lockKey);
  const lockInfo = {
    lockKey,
    owner: String(owner || "unknown"),
    profileDir: String(profileDir || ""),
    pid: process.pid,
    createdAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(JSON.stringify(lockInfo, null, 2), "utf8");
      } finally {
        await handle.close().catch(() => {});
      }

      let released = false;
      return {
        lockKey,
        lockPath,
        lockInfo,
        async release() {
          if (released) {
            return;
          }

          released = true;
          await rm(lockPath, { force: true }).catch(() => {});
        },
      };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }

      const existingLock = await readProfileLock(lockKey);
      if (!existingLock && attempt === 0) {
        continue;
      }

      throw createHttpError(
        `Browser profile is already in use by ${existingLock?.owner || "another task"}.`,
        409,
        "BROWSER_PROFILE_LOCKED",
        {
          lockKey,
          profileDir,
          existingLock,
        }
      );
    }
  }

  throw createHttpError(
    "Failed to acquire browser profile lock.",
    500,
    "BROWSER_PROFILE_LOCK_FAILED"
  );
}
