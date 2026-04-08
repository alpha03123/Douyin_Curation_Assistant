import path from "node:path";
import { rm } from "node:fs/promises";
import { DownloadTask } from "../../../models/DownloadTask.js";
import { DownloadedAsset } from "../../../models/DownloadedAsset.js";
import { Work } from "../../../models/Work.js";
import {
  buildCanonicalWorkUrl,
  createHttpError,
  resolveWorkDownloadDetail,
} from "./detailResolver.js";
import {
  buildAssetFileName,
  buildDownloadBaseName,
  buildDownloadDirectory,
  downloadFileToPath,
  ensureDownloadDirectory,
  listFilesRecursive,
  writeJsonFile,
} from "./fileService.js";
import { resolveDownloadAssets } from "./mediaResolver.js";
import { getMixAwemePage, getMusicDetail } from "./sourceApiClient.js";
import { resolveDownloadSource, resolveMusicFallbackAweme } from "./sourceResolver.js";
import { executeYtDlpDownload } from "./ytDlpService.js";

function buildXiaohongshuHeaders() {
  return {
    Referer: "https://www.xiaohongshu.com/",
    Origin: "https://www.xiaohongshu.com",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  };
}

const DEFAULT_TASK_LIMIT = 20;
const MAX_TASK_LIMIT = 100;
const DOWNLOADABLE_ASSETS = new Set([
  "video",
  "images",
  "cover",
  "music",
  "metadata",
]);
const activeTaskIds = new Set();

function normalizeAssets(assets = []) {
  return [...new Set((Array.isArray(assets) ? assets : []).map((item) => String(item || "").trim()))]
    .filter((item) => DOWNLOADABLE_ASSETS.has(item));
}

function buildTaskFilter(options = {}) {
  const filter = {};

  if (options.workId) {
    filter.workId = String(options.workId);
  }

  if (options.status) {
    filter.status = String(options.status);
  }

  if (options.sourceType) {
    filter.sourceType = String(options.sourceType);
  }

  return filter;
}

function queueDownloadTask(taskId) {
  const safeTaskId = String(taskId || "");
  if (!safeTaskId || activeTaskIds.has(safeTaskId)) {
    return;
  }

  activeTaskIds.add(safeTaskId);
  setTimeout(() => {
    processDownloadTask(safeTaskId)
      .catch(() => {})
      .finally(() => {
        activeTaskIds.delete(safeTaskId);
      });
  }, 0);
}

async function createAssetRecord({
  taskId,
  assetType,
  localAsset = null,
  sourceUrl = "",
  status = "success",
  errorMessage = "",
}) {
  return DownloadedAsset.create({
    taskId: String(taskId),
    assetType,
    sourceUrl,
    localPath: localAsset?.filePath || "",
    fileName: localAsset?.fileName || "",
    fileSize: Number(localAsset?.fileSize || 0),
    status,
    errorMessage,
  });
}

async function clearTaskAssets(taskId) {
  const assets = await DownloadedAsset.find({ taskId: String(taskId) });

  for (const asset of assets) {
    if (asset.localPath) {
      await rm(asset.localPath, { force: true }).catch(() => {});
    }
    await DownloadedAsset.findByIdAndDelete(asset._id);
  }
}

async function markTaskRunning(taskId) {
  await DownloadTask.findByIdAndUpdate(taskId, {
    status: "running",
    errorMessage: "",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    downloadedFiles: 0,
    failedFiles: 0,
  });
}

async function markTaskFinished(taskId, payload) {
  return DownloadTask.findByIdAndUpdate(taskId, {
    ...payload,
    finishedAt: new Date().toISOString(),
  });
}

async function executeSingleAsset({ taskId, workLike, detail, asset, saveDir, baseName }) {
  const fileName = buildAssetFileName({
    baseName,
    assetType: asset.assetType,
    sequence: asset.sequence,
    sourceUrl: asset.sourceUrl,
  });
  const destinationPath = path.join(saveDir, fileName);

  if (asset.assetType === "metadata") {
    const localAsset = await writeJsonFile(destinationPath, {
      work: workLike,
      detail,
    });
    await createAssetRecord({
      taskId,
      assetType: asset.assetType,
      localAsset,
    });
    return localAsset;
  }

  const localAsset = await downloadFileToPath(
    asset.sourceUrl,
    destinationPath,
    asset.headers || {}
  );
  await createAssetRecord({
    taskId,
    assetType: asset.assetType,
    localAsset,
    sourceUrl: asset.sourceUrl,
  });
  return localAsset;
}

async function downloadAssetsForResolvedAweme({
  task,
  detail,
  workLike,
  trackTaskProgress = true,
}) {
  const referer = buildCanonicalWorkUrl(workLike);
  const { parsedType, assets } = resolveDownloadAssets(detail, {
    assets: task.options?.assets || [],
    removeWatermark: task.options?.removeWatermark !== false,
    referer,
  });

  if (assets.length === 0) {
    throw createHttpError("Current source has no downloadable assets.", 400, "DOWNLOAD_NO_ASSETS");
  }

  const saveDir = await ensureDownloadDirectory(buildDownloadDirectory(workLike, detail));
  const baseName = buildDownloadBaseName(workLike, detail);
  let downloadedFiles = 0;
  let failedFiles = 0;

  for (const asset of assets) {
    try {
      await executeSingleAsset({
        taskId: task._id,
        workLike,
        detail,
        asset,
        saveDir,
        baseName,
      });
      downloadedFiles += 1;
    } catch (error) {
      failedFiles += 1;
      await createAssetRecord({
        taskId: task._id,
        assetType: asset.assetType,
        sourceUrl: asset.sourceUrl,
        status: "failed",
        errorMessage: error.message || "Download failed",
      });
    }

    if (trackTaskProgress) {
      await DownloadTask.findByIdAndUpdate(task._id, {
        downloadedFiles,
        failedFiles,
      });
    }
  }

  return {
    parsedType,
    saveDir,
    totalFiles: assets.length,
    downloadedFiles,
    failedFiles,
  };
}

async function executeResolvedAwemeDownload({
  task,
  detail,
  workLike,
}) {
  const result = await downloadAssetsForResolvedAweme({
    task,
    detail,
    workLike,
  });

  const finalStatus =
    result.downloadedFiles > 0 && result.failedFiles === 0
      ? "success"
      : result.downloadedFiles > 0
        ? "partial_success"
        : "failed";

  return markTaskFinished(task._id, {
    status: finalStatus,
    errorMessage: finalStatus === "success" ? "" : "One or more assets failed to download.",
    downloadedFiles: result.downloadedFiles,
    failedFiles: result.failedFiles,
    saveDir: result.saveDir,
    parsedType: result.parsedType,
    totalFiles: result.totalFiles,
    title: workLike.title || workLike.desc || task.title || "",
    authorName: workLike.authorName || task.authorName || "",
    itemCount: 1,
  });
}

async function executeXiaohongshuDownload(task, source) {
  const requestedAssets = new Set(task.options?.assets || []);
  const assets = [];

  if (
    source.parsedType === "video" &&
    requestedAssets.has("video") &&
    source.detail?.videoUrl
  ) {
    assets.push({
      assetType: "video",
      sourceUrl: source.detail.videoUrl,
      headers: buildXiaohongshuHeaders(),
    });
  }

  if (source.parsedType === "gallery" && requestedAssets.has("images")) {
    for (const [index, url] of (source.detail?.imageUrls || []).entries()) {
      assets.push({
        assetType: "image",
        sourceUrl: url,
        sequence: index + 1,
        headers: buildXiaohongshuHeaders(),
      });
    }
  }

  if (requestedAssets.has("cover") && source.detail?.coverUrl) {
    assets.push({
      assetType: "cover",
      sourceUrl: source.detail.coverUrl,
      headers: buildXiaohongshuHeaders(),
    });
  }

  if (requestedAssets.has("metadata")) {
    assets.push({
      assetType: "metadata",
      sourceUrl: "",
      headers: {},
    });
  }

  const workLike = {
    awemeId: source.sourceId,
    workType: source.parsedType === "gallery" ? "image" : "video",
    title: source.title,
    desc: source.title,
    authorName: source.authorName,
    workUrl: source.normalizedUrl,
  };

  return executeResolvedGenericDownload({
    task,
    detail: source.detail?.note || source.detail || {},
    workLike,
    assets,
    parsedType: source.parsedType,
  });
}

async function executeResolvedGenericDownload({
  task,
  detail,
  workLike,
  assets,
  parsedType,
}) {
  if (!assets.length) {
    throw createHttpError("Current source has no downloadable assets.", 400, "DOWNLOAD_NO_ASSETS");
  }

  const saveDir = await ensureDownloadDirectory(buildDownloadDirectory(workLike, detail));
  const baseName = buildDownloadBaseName(workLike, detail);
  let downloadedFiles = 0;
  let failedFiles = 0;

  await DownloadTask.findByIdAndUpdate(task._id, {
    parsedType,
    saveDir,
    totalFiles: assets.length,
    title: workLike.title || task.title || "",
    authorName: workLike.authorName || task.authorName || "",
    itemCount: 1,
    awemeId: workLike.awemeId || task.awemeId || "",
  });

  for (const asset of assets) {
    try {
      await executeSingleAsset({
        taskId: task._id,
        workLike,
        detail,
        asset,
        saveDir,
        baseName,
      });
      downloadedFiles += 1;
    } catch (error) {
      failedFiles += 1;
      await createAssetRecord({
        taskId: task._id,
        assetType: asset.assetType,
        sourceUrl: asset.sourceUrl,
        status: "failed",
        errorMessage: error.message || "Download failed",
      });
    }

    await DownloadTask.findByIdAndUpdate(task._id, {
      downloadedFiles,
      failedFiles,
    });
  }

  const finalStatus =
    downloadedFiles > 0 && failedFiles === 0
      ? "success"
      : downloadedFiles > 0
        ? "partial_success"
        : "failed";

  return markTaskFinished(task._id, {
    status: finalStatus,
    errorMessage: finalStatus === "success" ? "" : "One or more assets failed to download.",
    downloadedFiles,
    failedFiles,
    saveDir,
    parsedType,
  });
}

async function executeYtDlpPlatformDownload(task, source) {
  const workLike = {
    awemeId: source.sourceId || task.sourceId,
    sourceId: source.sourceId || task.sourceId,
    workType: source.parsedType === "collection" ? "playlist" : source.parsedType,
    title: source.title || task.title || task.sourceId,
    desc: source.title || task.title || task.sourceId,
    authorName: source.authorName || task.authorName || "",
    workUrl: source.normalizedUrl || task.normalizedUrl || task.sourceUrl,
  };
  const saveDir = await ensureDownloadDirectory(buildDownloadDirectory(workLike, {}));
  const outputTemplate = path.join(saveDir, "%(id)s.%(ext)s");

  await DownloadTask.findByIdAndUpdate(task._id, {
    platform: source.platform || task.platform || "unknown",
    parsedType: source.parsedType || task.parsedType || "unknown",
    title: source.title || task.title || "",
    authorName: source.authorName || task.authorName || "",
    itemCount: source.itemCount || task.itemCount || 1,
    normalizedUrl: source.normalizedUrl || task.normalizedUrl || task.sourceUrl,
    sourceId: source.sourceId || task.sourceId || "",
    awemeId: source.sourceId || task.awemeId || "",
    saveDir,
  });

  await executeYtDlpDownload({
    sourceUrl: source.normalizedUrl || task.normalizedUrl || task.sourceUrl,
    outputTemplate,
    assets: task.options?.assets || [],
  });

  const files = await listFilesRecursive(saveDir);
  for (const file of files) {
    const lowerName = file.fileName.toLowerCase();
    let assetType = "file";
    if (lowerName.endsWith(".info.json") || lowerName.endsWith(".json")) {
      assetType = "metadata";
    } else if (/\.(jpg|jpeg|png|webp)$/.test(lowerName)) {
      assetType = lowerName.includes("thumb") || lowerName.includes("cover") ? "cover" : "image";
    } else if (/\.(mp3|m4a|aac|wav|opus|ogg)$/.test(lowerName)) {
      assetType = "music";
    } else if (/\.(mp4|mkv|webm|mov|flv)$/.test(lowerName)) {
      assetType = "video";
    }

    await createAssetRecord({
      taskId: task._id,
      assetType,
      localAsset: file,
      sourceUrl: source.normalizedUrl || task.sourceUrl,
    });
  }

  return markTaskFinished(task._id, {
    status: files.length > 0 ? "success" : "failed",
    errorMessage: files.length > 0 ? "" : "No files were produced by yt-dlp.",
    downloadedFiles: files.length,
    failedFiles: 0,
    totalFiles: files.length,
    saveDir,
    parsedType: source.parsedType || task.parsedType || "unknown",
  });
}

async function executeMusicDownload(task) {
  const normalizedUrl = task.normalizedUrl || task.sourceUrl;
  const detail = await getMusicDetail(task.sourceId, normalizedUrl);
  const fallbackAweme = await resolveMusicFallbackAweme(task.sourceId, normalizedUrl);
  const workLike = {
    awemeId: fallbackAweme?.aweme_id || task.sourceId,
    workType: "audio",
    title: detail?.title || detail?.music_name || task.title || task.sourceId,
    authorName: detail?.owner?.nickname || detail?.author_name || task.authorName || "",
    workUrl: normalizedUrl,
  };

  const coverUrl =
    detail?.cover_large?.url_list?.[0] ||
    detail?.cover_thumb?.url_list?.[0] ||
    detail?.cover_medium?.url_list?.[0] ||
    "";
  const musicUrl =
    detail?.play_url?.url_list?.[0] ||
    detail?.play_url_lowbr?.url_list?.[0] ||
    detail?.audio_url?.url_list?.[0] ||
    "";

  const requestedAssets = new Set(task.options?.assets || []);
  const assets = [];

  if (requestedAssets.has("music") && musicUrl) {
    assets.push({
      assetType: "music",
      sourceUrl: musicUrl,
      headers: {},
    });
  }

  if (requestedAssets.has("cover") && coverUrl) {
    assets.push({
      assetType: "cover",
      sourceUrl: coverUrl,
      headers: {},
    });
  }

  if (requestedAssets.has("metadata")) {
    assets.push({
      assetType: "metadata",
      sourceUrl: "",
      headers: {},
    });
  }

  if (assets.length === 0) {
    throw createHttpError("Current music source has no downloadable assets.", 400, "DOWNLOAD_NO_ASSETS");
  }

  const saveDir = await ensureDownloadDirectory(buildDownloadDirectory(workLike, {
    create_time: fallbackAweme?.create_time || 0,
    desc: workLike.title,
  }));
  const baseName = buildDownloadBaseName(workLike, {
    create_time: fallbackAweme?.create_time || 0,
    desc: workLike.title,
  });
  let downloadedFiles = 0;
  let failedFiles = 0;

  await DownloadTask.findByIdAndUpdate(task._id, {
    parsedType: "music",
    saveDir,
    totalFiles: assets.length,
    title: workLike.title,
    authorName: workLike.authorName,
    itemCount: 1,
    awemeId: workLike.awemeId,
  });

  for (const asset of assets) {
    try {
      await executeSingleAsset({
        taskId: task._id,
        workLike,
        detail,
        asset,
        saveDir,
        baseName,
      });
      downloadedFiles += 1;
    } catch (error) {
      failedFiles += 1;
      await createAssetRecord({
        taskId: task._id,
        assetType: asset.assetType,
        sourceUrl: asset.sourceUrl,
        status: "failed",
        errorMessage: error.message || "Download failed",
      });
    }

    await DownloadTask.findByIdAndUpdate(task._id, {
      downloadedFiles,
      failedFiles,
    });
  }

  const finalStatus =
    downloadedFiles > 0 && failedFiles === 0
      ? "success"
      : downloadedFiles > 0
        ? "partial_success"
        : "failed";

  return markTaskFinished(task._id, {
    status: finalStatus,
    errorMessage: finalStatus === "success" ? "" : "One or more assets failed to download.",
    downloadedFiles,
    failedFiles,
    saveDir,
    parsedType: "music",
  });
}

async function executeCollectionDownload(task) {
  const normalizedUrl = task.normalizedUrl || task.sourceUrl;
  let cursor = 0;
  let hasMore = true;
  let items = [];

  while (hasMore) {
    const page = await getMixAwemePage(task.sourceId, cursor, 20, normalizedUrl);
    items = items.concat(page.items || []);
    hasMore = page.hasMore;
    if (!hasMore) {
      break;
    }
    const nextCursor = Number(page.cursor || 0);
    if (nextCursor === cursor) {
      break;
    }
    cursor = nextCursor;
  }

  if (items.length === 0) {
    throw createHttpError("Collection contains no downloadable works.", 404, "DOWNLOAD_COLLECTION_EMPTY");
  }

  await DownloadTask.findByIdAndUpdate(task._id, {
    parsedType: "collection",
    itemCount: items.length,
    totalFiles: items.length,
    downloadedFiles: 0,
    failedFiles: 0,
  });

  let downloadedFiles = 0;
  let failedFiles = 0;
  let lastSaveDir = "";

  for (const item of items) {
    try {
      const result = await downloadAssetsForResolvedAweme({
        task,
        detail: item,
        workLike: {
          awemeId: item.aweme_id,
          workType:
            item.image_post_info || item.images?.length ? "image" : "video",
          title: item.desc || "",
          desc: item.desc || "",
          authorName: item.author?.nickname || task.authorName || "",
          workUrl: buildCanonicalWorkUrl({
            awemeId: item.aweme_id,
            workType: item.image_post_info || item.images?.length ? "image" : "video",
          }),
        },
        trackTaskProgress: false,
      });
      if (result.downloadedFiles > 0) {
        downloadedFiles += 1;
      } else {
        failedFiles += 1;
      }
      if (result.failedFiles > 0 && result.downloadedFiles > 0) {
        failedFiles += 1;
      }
      lastSaveDir = result.saveDir || lastSaveDir;
    } catch (error) {
      failedFiles += 1;
    }

    await DownloadTask.findByIdAndUpdate(task._id, {
      downloadedFiles,
      failedFiles,
    });
  }

  const finalStatus =
    downloadedFiles > 0 && failedFiles === 0
      ? "success"
      : downloadedFiles > 0
      ? "partial_success"
        : "failed";

  return markTaskFinished(task._id, {
    status: finalStatus,
    errorMessage: finalStatus === "success" ? "" : "One or more collection items failed to download.",
    downloadedFiles,
    failedFiles,
    parsedType: "collection",
    saveDir: lastSaveDir,
  });
}

async function processDownloadTask(taskId) {
  const task = await DownloadTask.findById(taskId);
  if (!task) {
    return null;
  }

  await markTaskRunning(taskId);

  try {
    if (task.sourceType === "work") {
      const work = await Work.findById(task.workId);
      if (!work) {
        throw createHttpError("Associated work does not exist.", 404, "DOWNLOAD_WORK_NOT_FOUND");
      }

      const detail = await resolveWorkDownloadDetail(work);
      return executeResolvedAwemeDownload({
        task,
        detail,
        workLike: work.toObject ? work.toObject() : work,
      });
    }

    if (task.sourceType === "url") {
      const source = await resolveDownloadSource(task.sourceUrl);

      if (["bilibili", "instagram", "tiktok", "x"].includes(source.platform)) {
        return executeYtDlpPlatformDownload(
          {
            ...(task.toObject ? task.toObject() : task),
            _id: task._id,
            options: task.options,
          },
          source
        );
      }

      if (source.platform === "xiaohongshu") {
        await DownloadTask.findByIdAndUpdate(taskId, {
          platform: "xiaohongshu",
          parsedType: source.parsedType,
          title: source.title,
          authorName: source.authorName,
          itemCount: source.itemCount,
          normalizedUrl: source.normalizedUrl,
          sourceId: source.sourceId,
          awemeId: source.sourceId,
        });
        return executeXiaohongshuDownload(
          {
            ...(task.toObject ? task.toObject() : task),
            _id: task._id,
            options: task.options,
          },
          source
        );
      }

      if (task.parsedType === "music") {
        return executeMusicDownload(task);
      }

      if (task.parsedType === "collection") {
        return executeCollectionDownload(task);
      }
      if (source.parsedType === "collection") {
        await DownloadTask.findByIdAndUpdate(taskId, {
          platform: source.platform || "douyin",
          parsedType: source.parsedType,
          title: source.title,
          authorName: source.authorName,
          itemCount: source.itemCount,
          normalizedUrl: source.normalizedUrl,
          sourceId: source.sourceId,
        });
        return executeCollectionDownload({
          ...(task.toObject ? task.toObject() : task),
          ...source,
          _id: task._id,
          options: task.options,
        });
      }

      if (source.parsedType === "music") {
        await DownloadTask.findByIdAndUpdate(taskId, {
          platform: source.platform || "douyin",
          parsedType: source.parsedType,
          title: source.title,
          authorName: source.authorName,
          itemCount: source.itemCount,
          normalizedUrl: source.normalizedUrl,
          sourceId: source.sourceId,
        });
        return executeMusicDownload({
          ...(task.toObject ? task.toObject() : task),
          ...source,
          _id: task._id,
          options: task.options,
        });
      }

      const detail = await resolveDownloadSource(task.sourceUrl).then(async (source) => {
        const resolvedDetail = await resolveWorkDownloadDetail({
          awemeId: source.sourceId,
          workType: source.parsedType === "gallery" ? "image" : "video",
          workUrl: source.normalizedUrl,
          title: source.title,
          authorName: source.authorName,
        });
        return { source, detail: resolvedDetail };
      });

      await DownloadTask.findByIdAndUpdate(taskId, {
        platform: source.platform || "douyin",
        parsedType: detail.source.parsedType,
        title: detail.source.title,
        authorName: detail.source.authorName,
        itemCount: 1,
        normalizedUrl: detail.source.normalizedUrl,
        sourceId: detail.source.sourceId,
        awemeId: detail.source.sourceId,
      });

      return executeResolvedAwemeDownload({
        task: {
          ...(task.toObject ? task.toObject() : task),
          ...detail.source,
          _id: task._id,
          options: task.options,
        },
        detail: detail.detail,
        workLike: {
          awemeId: detail.source.sourceId,
          workType: detail.source.parsedType === "gallery" ? "image" : "video",
          title: detail.source.title,
          desc: detail.source.title,
          authorName: detail.source.authorName,
          workUrl: detail.source.normalizedUrl,
        },
      });
    }

    throw createHttpError("Unsupported download source type.", 400, "DOWNLOAD_UNSUPPORTED_SOURCE");
  } catch (error) {
    await markTaskFinished(taskId, {
      status: "failed",
      errorMessage: error.message || "Download task failed.",
    });
    return null;
  }
}

export async function resolveDownloadSourcePreview(sourceUrl = "") {
  return resolveDownloadSource(sourceUrl);
}

export async function createWorkDownloadTask(payload = {}) {
  const workId = String(payload.workId || "").trim();
  if (!workId) {
    throw createHttpError("workId is required.", 400, "DOWNLOAD_WORK_ID_REQUIRED");
  }

  const assets = normalizeAssets(payload.assets);
  if (assets.length === 0) {
    throw createHttpError("At least one asset is required.", 400, "DOWNLOAD_ASSETS_REQUIRED");
  }

  const work = await Work.findById(workId);
  if (!work) {
    throw createHttpError("Work not found.", 404, "DOWNLOAD_WORK_NOT_FOUND");
  }

  const task = await DownloadTask.create({
    platform: "douyin",
    sourceType: "work",
    sourceId: workId,
    workId,
    sourceUrl: buildCanonicalWorkUrl(work),
    normalizedUrl: buildCanonicalWorkUrl(work),
    awemeId: String(work.awemeId || ""),
    parsedType: String(work.workType || "unknown"),
    title: work.title || work.desc || work.awemeId || "",
    authorName: work.authorName || "",
    itemCount: 1,
    status: "pending",
    options: {
      assets,
      removeWatermark: payload.removeWatermark !== false,
    },
    saveDir: "",
    totalFiles: 0,
    downloadedFiles: 0,
    failedFiles: 0,
    errorMessage: "",
    startedAt: null,
    finishedAt: null,
  });

  queueDownloadTask(task._id);
  return task;
}

export async function createUrlDownloadTask(payload = {}) {
  const sourceUrl = String(payload.sourceUrl || "").trim();
  if (!sourceUrl) {
    throw createHttpError("sourceUrl is required.", 400, "DOWNLOAD_SOURCE_URL_REQUIRED");
  }

  const assets = normalizeAssets(payload.assets);
  if (assets.length === 0) {
    throw createHttpError("At least one asset is required.", 400, "DOWNLOAD_ASSETS_REQUIRED");
  }

  const source = await resolveDownloadSource(sourceUrl);
  const task = await DownloadTask.create({
    platform: source.platform || "douyin",
    sourceType: "url",
    sourceId: source.sourceId,
    workId: null,
    sourceUrl,
    normalizedUrl: source.normalizedUrl,
    awemeId: source.parsedType === "music" || source.parsedType === "collection" ? "" : source.sourceId,
    parsedType: source.parsedType,
    title: source.title,
    authorName: source.authorName,
    itemCount: source.itemCount || 0,
    status: "pending",
    options: {
      assets,
      removeWatermark: payload.removeWatermark !== false,
    },
    saveDir: "",
    totalFiles: 0,
    downloadedFiles: 0,
    failedFiles: 0,
    errorMessage: "",
    startedAt: null,
    finishedAt: null,
  });

  queueDownloadTask(task._id);
  return task;
}

export async function listDownloadTasks(options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || DEFAULT_TASK_LIMIT, MAX_TASK_LIMIT));
  return DownloadTask.find(buildTaskFilter(options))
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(limit);
}

export async function getDownloadTaskById(taskId) {
  const task = await DownloadTask.findById(taskId);
  if (!task) {
    throw createHttpError("Download task not found.", 404, "DOWNLOAD_TASK_NOT_FOUND");
  }

  return task;
}

export async function getDownloadedAssetsByTaskId(taskId) {
  await getDownloadTaskById(taskId);
  return DownloadedAsset.find({ taskId: String(taskId) }).sort({
    createdAt: 1,
    updatedAt: 1,
  });
}

export async function retryDownloadTask(taskId) {
  const task = await getDownloadTaskById(taskId);
  await clearTaskAssets(taskId);
  const retried = await DownloadTask.findByIdAndUpdate(taskId, {
    status: "pending",
    errorMessage: "",
    totalFiles: 0,
    downloadedFiles: 0,
    failedFiles: 0,
    saveDir: "",
    startedAt: null,
    finishedAt: null,
  });
  queueDownloadTask(task._id);
  return retried;
}
