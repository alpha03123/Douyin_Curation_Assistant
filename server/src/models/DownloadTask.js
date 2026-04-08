import { createLiteModel } from "../storage/liteModel.js";

export const DownloadTask = createLiteModel({
  modelName: "DownloadTask",
  tableName: "download_tasks",
  defaults: {
    platform: "douyin",
    sourceType: "work",
    sourceId: "",
    workId: null,
    sourceUrl: "",
    normalizedUrl: "",
    awemeId: "",
    parsedType: "unknown",
    title: "",
    authorName: "",
    itemCount: 0,
    status: "pending",
    options: {
      assets: [],
      removeWatermark: true,
    },
    saveDir: "",
    totalFiles: 0,
    downloadedFiles: 0,
    failedFiles: 0,
    errorMessage: "",
    startedAt: null,
    finishedAt: null,
  },
});
