import path from "node:path";
import { spawn } from "node:child_process";
import { env } from "../../config/env.js";

function createHttpError(message, statusCode = 500, code = null, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function getPythonCandidates() {
  return [
    process.env.LEGACY_SPIDER_PYTHON,
    path.resolve(env.projectRoot, "..", ".venv", "Scripts", "python.exe"),
    path.resolve(env.projectRoot, ".venv", "Scripts", "python.exe"),
    "python",
  ].filter(Boolean);
}

function spawnProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || env.projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        ...(options.env || {}),
      },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.once("error", reject);
    child.once("close", (code) => {
      resolve({
        code: Number(code || 0),
        stdout,
        stderr,
      });
    });
  });
}

async function findPythonExecutable() {
  for (const candidate of getPythonCandidates()) {
    try {
      const result = await spawnProcess(candidate, ["--version"]);
      if (result.code === 0) {
        return candidate;
      }
    } catch {
      continue;
    }
  }

  throw createHttpError(
    "No usable Python runtime was found for legacy keyword search.",
    500,
    "LEGACY_PYTHON_MISSING"
  );
}

export async function searchGeneralWorkPageViaLegacyPython({
  cookieString,
  query,
  offset = "0",
  count = "25",
  sortType = "0",
  publishTime = "0",
  filterDuration = "",
  searchRange = "0",
  contentType = "0",
} = {}) {
  if (!cookieString || !query) {
    throw createHttpError(
      "Legacy keyword search requires cookieString and query.",
      400,
      "LEGACY_SEARCH_INPUT_MISSING"
    );
  }

  const python = await findPythonExecutable();
  const scriptPath = path.resolve(
    env.projectRoot,
    "server",
    "src",
    "scripts",
    "legacyKeywordSearch.py"
  );
  const legacyRoot = path.resolve(
    env.projectRoot,
    env.legacyProjectPath || ".."
  );
  const args = [
    scriptPath,
    "--legacy-root",
    legacyRoot,
    "--cookie-string",
    cookieString,
    "--query",
    query,
    "--offset",
    String(offset ?? "0"),
    "--count",
    String(count ?? "25"),
    "--sort-type",
    String(sortType ?? "0"),
    "--publish-time",
    String(publishTime ?? "0"),
    "--filter-duration",
    String(filterDuration ?? ""),
    "--search-range",
    String(searchRange ?? "0"),
    "--content-type",
    String(contentType ?? "0"),
  ];
  const result = await spawnProcess(python, args, {
    cwd: legacyRoot,
    env: {
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
      PYTHONPATH: legacyRoot,
    },
  });

  if (result.code !== 0) {
    throw createHttpError(
      result.stderr.trim() || "Legacy keyword search failed.",
      500,
      "LEGACY_SEARCH_FAILED",
      {
        stderr: result.stderr,
      }
    );
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw createHttpError(
      "Legacy keyword search returned invalid JSON.",
      500,
      "LEGACY_SEARCH_INVALID_JSON",
      {
        stdout: result.stdout.slice(0, 500),
        parseError: error.message,
      }
    );
  }
}
