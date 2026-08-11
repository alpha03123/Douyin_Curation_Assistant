import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../..");
const legacyRoot = path.resolve(projectRoot, "..");

dotenv.config({ path: path.resolve(projectRoot, ".env") });
dotenv.config({ path: path.resolve(legacyRoot, ".env") });
dotenv.config();

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function parseStringList(value, fallback = []) {
  if (value === undefined || value === null || value === "") {
    return [...fallback];
  }

  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const clientOrigins = parseStringList(
  process.env.CLIENT_ORIGINS || process.env.CLIENT_ORIGIN,
  ["http://localhost:5173"]
);

export const env = {
  projectRoot,
  port: Number(process.env.PORT || 3001),
  host: process.env.HOST || "127.0.0.1",
  dataRoot:
    process.env.DATA_ROOT || path.resolve(projectRoot, "jsonData"),
  sqlitePath:
    process.env.SQLITE_PATH ||
    path.resolve(
      process.env.DATA_ROOT || path.resolve(projectRoot, "jsonData"),
      "douyin_curation_assistant.db"
    ),
  downloadRoot:
    process.env.DOWNLOAD_ROOT ||
    path.resolve(
      process.env.DATA_ROOT || path.resolve(projectRoot, "jsonData"),
      "downloads"
    ),
  clientOrigin: clientOrigins[0] || "",
  clientOrigins,
  legacyProjectPath:
    process.env.LEGACY_PROJECT_PATH || legacyRoot,
  dyCookies: process.env.DY_COOKIES || "",
  actionBrowserHeadless: parseBoolean(process.env.ACTION_BROWSER_HEADLESS, false),
  actionBrowserKeepOpenOnFailure: parseBoolean(
    process.env.ACTION_BROWSER_KEEP_OPEN_ON_FAILURE,
    true
  ),
  actionBrowserFailureHoldMs: Math.max(
    5000,
    Number(process.env.ACTION_BROWSER_FAILURE_HOLD_MS || 45000)
  ),
  actionBrowserTimeoutMs: Math.max(
    15000,
    Number(process.env.ACTION_BROWSER_TIMEOUT_MS || 60000)
  ),
  browserLoginTimeoutMs: Math.max(
    60000,
    Number(process.env.BROWSER_LOGIN_TIMEOUT_MS || 600000)
  ),
  actionCaptureTargetUrl:
    process.env.ACTION_CAPTURE_TARGET_URL ||
    "https://www.douyin.com/?recommend=1",
};
