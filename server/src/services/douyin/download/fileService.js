import path from "node:path";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { env } from "../../../config/env.js";

function sanitizeSegment(value = "", fallback = "untitled") {
  const normalized = String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || fallback;
}

function getDatePrefix(createTime) {
  if (!createTime) {
    return new Date().toISOString().slice(0, 10);
  }

  const date = new Date(Number(createTime) * 1000);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }

  return date.toISOString().slice(0, 10);
}

function inferExtension(sourceUrl = "", assetType = "") {
  const pathname = (() => {
    try {
      return new URL(sourceUrl).pathname || "";
    } catch {
      return "";
    }
  })();
  const ext = path.extname(pathname).toLowerCase();

  if (ext) {
    return ext;
  }

  if (assetType === "video") {
    return ".mp4";
  }

  if (assetType === "image" || assetType === "cover") {
    return ".jpg";
  }

  if (assetType === "music") {
    return ".mp3";
  }

  if (assetType === "metadata") {
    return ".json";
  }

  return "";
}

export function buildDownloadDirectory(work, detail = {}) {
  const authorName = sanitizeSegment(
    work?.authorName || detail?.author?.nickname || "unknown-author",
    "unknown-author"
  );
  const title = sanitizeSegment(
    work?.title || work?.desc || detail?.desc || detail?.aweme_id || "untitled",
    "untitled"
  );
  const awemeId = String(work?.awemeId || detail?.aweme_id || "unknown");
  const datePrefix = getDatePrefix(detail?.create_time);

  return path.join(
    env.downloadRoot,
    authorName,
    "work",
    `${datePrefix}_${title}_${awemeId}`
  );
}

export function buildAssetFileName({ baseName, assetType, sequence, sourceUrl }) {
  const extension = inferExtension(sourceUrl, assetType);

  if (assetType === "image") {
    return `${baseName}_${String(sequence || 1).padStart(2, "0")}${extension}`;
  }

  if (assetType === "cover") {
    return `${baseName}_cover${extension}`;
  }

  if (assetType === "music") {
    return `${baseName}_music${extension}`;
  }

  if (assetType === "metadata") {
    return `${baseName}_data${extension}`;
  }

  return `${baseName}${extension}`;
}

export function buildDownloadBaseName(work, detail = {}) {
  return sanitizeSegment(
    work?.awemeId || detail?.aweme_id || work?.sourceId || detail?.noteId || "unknown",
    "unknown"
  );
}

export async function ensureDownloadDirectory(directoryPath) {
  await mkdir(directoryPath, { recursive: true });
  return directoryPath;
}

export async function downloadFileToPath(url, destinationPath, headers = {}) {
  const response = await fetch(url, {
    method: "GET",
    headers,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Download failed with status ${response.status}`);
  }

  const tempPath = `${destinationPath}.tmp`;

  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(tempPath));
    await rename(tempPath, destinationPath);
    const fileStat = await stat(destinationPath);
    return {
      filePath: destinationPath,
      fileName: path.basename(destinationPath),
      fileSize: Number(fileStat.size || 0),
    };
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function writeJsonFile(destinationPath, payload) {
  const content = JSON.stringify(payload, null, 2);
  await writeFile(destinationPath, content, "utf8");
  const fileStat = await stat(destinationPath);
  return {
    filePath: destinationPath,
    fileName: path.basename(destinationPath),
    fileSize: Number(fileStat.size || 0),
  };
}

export async function listFilesRecursive(directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(fullPath)));
      continue;
    }

    const fileStat = await stat(fullPath);
    files.push({
      filePath: fullPath,
      fileName: entry.name,
      fileSize: Number(fileStat.size || 0),
    });
  }

  return files;
}
