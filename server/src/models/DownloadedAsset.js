import { createLiteModel } from "../storage/liteModel.js";

export const DownloadedAsset = createLiteModel({
  modelName: "DownloadedAsset",
  tableName: "downloaded_assets",
  defaults: {
    taskId: "",
    assetType: "",
    sourceUrl: "",
    localPath: "",
    fileName: "",
    fileSize: 0,
    status: "success",
    errorMessage: "",
  },
});
