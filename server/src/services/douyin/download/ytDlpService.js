import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { env } from "../../../config/env.js";
import { createHttpError } from "./sourceApiClient.js";

function getPythonCandidates() {
  return [
    process.env.YT_DLP_PYTHON,
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
    "No usable Python runtime was found for yt-dlp.",
    500,
    "YT_DLP_PYTHON_MISSING"
  );
}

function normalizeExtractorPlatform(extractorKey = "") {
  const value = String(extractorKey || "").toLowerCase();
  if (value.includes("bili")) return "bilibili";
  if (value.includes("instagram")) return "instagram";
  if (value.includes("tiktok")) return "tiktok";
  if (value.includes("twitter")) return "x";
  if (value.includes("xiaohongshu")) return "xiaohongshu";
  if (value.includes("douyin")) return "douyin";
  return "unknown";
}

function buildSupportedAssets(metadata = {}) {
  const isPlaylist = Array.isArray(metadata.entries) && metadata.entries.length > 0;
  const extractorPlatform = normalizeExtractorPlatform(metadata.extractor_key);
  const hasVideo =
    metadata.vcodec !== "none" ||
    (Array.isArray(metadata.formats) &&
      metadata.formats.some((item) => item?.vcodec && item.vcodec !== "none"));
  const hasAudio =
    metadata.acodec !== "none" ||
    (Array.isArray(metadata.formats) &&
      metadata.formats.some((item) => item?.acodec && item.acodec !== "none"));

  if (isPlaylist) {
    return ["images", "metadata"];
  }

  const assets = [];
  if (hasVideo) {
    assets.push("video");
  }
  if (hasAudio && ["douyin", "bilibili", "instagram", "tiktok", "x"].includes(extractorPlatform)) {
    assets.push("music");
  }
  if (metadata.thumbnail || (Array.isArray(metadata.thumbnails) && metadata.thumbnails.length > 0)) {
    assets.push("cover");
  }
  assets.push("metadata");

  return [...new Set(assets)];
}

export async function resolveWithYtDlp(sourceUrl) {
  const python = await findPythonExecutable();
  const args = [
    "-m",
    "yt_dlp",
    "--dump-single-json",
    "--no-warnings",
    "--no-check-certificates",
    "--skip-download",
    sourceUrl,
  ];

  const result = await spawnProcess(python, args, { cwd: env.projectRoot });
  if (result.code !== 0) {
    throw createHttpError(
      result.stderr || "yt-dlp failed to resolve the source.",
      502,
      "YT_DLP_RESOLVE_FAILED"
    );
  }

  const metadata = JSON.parse(result.stdout);
  const platform = normalizeExtractorPlatform(metadata.extractor_key);
  const isPlaylist = Array.isArray(metadata.entries) && metadata.entries.length > 0;
  const parsedType = isPlaylist
    ? "collection"
    : metadata.vcodec === "none" && metadata.acodec !== "none"
      ? "music"
      : "video";

  return {
    platform,
    sourceType: "url",
    parsedType,
    sourceId: String(metadata.id || ""),
    normalizedUrl: metadata.webpage_url || metadata.original_url || sourceUrl,
    title: metadata.title || metadata.fulltitle || metadata.id || "-",
    authorName: metadata.uploader || metadata.channel || metadata.artist || "unknown-author",
    itemCount: isPlaylist ? metadata.entries.length : 1,
    supportedAssets: buildSupportedAssets(metadata),
    options: {
      removeWatermark: false,
    },
    detail: metadata,
  };
}

export async function executeYtDlpDownload({
  sourceUrl,
  outputTemplate,
  assets = [],
}) {
  const python = await findPythonExecutable();
  const requestedAssets = new Set(assets);
  const args = [
    "-m",
    "yt_dlp",
    "--no-warnings",
    "--no-check-certificates",
    "--paths",
    "home:.",
    "--output",
    outputTemplate,
  ];

  if (requestedAssets.has("cover")) {
    args.push("--write-thumbnail");
  }

  if (requestedAssets.has("metadata")) {
    args.push("--write-info-json");
  }

  if (requestedAssets.has("music")) {
    args.push("--extract-audio", "--audio-format", "mp3");
    if (requestedAssets.has("video")) {
      args.push("--keep-video");
    }
    if (ffmpegPath) {
      args.push("--ffmpeg-location", path.dirname(ffmpegPath));
    }
  }

  if (
    !requestedAssets.has("video") &&
    !requestedAssets.has("images") &&
    !requestedAssets.has("music")
  ) {
    args.push("--skip-download");
  }

  args.push(sourceUrl);

  const result = await spawnProcess(python, args, { cwd: env.projectRoot });
  if (result.code !== 0) {
    throw createHttpError(
      result.stderr || "yt-dlp download failed.",
      502,
      "YT_DLP_DOWNLOAD_FAILED"
    );
  }

  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
