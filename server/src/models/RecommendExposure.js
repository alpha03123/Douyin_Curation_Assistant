import { createLiteModel } from "../storage/liteModel.js";

export const RecommendExposure = createLiteModel({
  modelName: "RecommendExposure",
  tableName: "recommend_exposures",
  uniqueFields: ["exposureKey"],
  defaults: {
    exposureKey: "",
    runId: "",
    workId: "",
    recommendWorkId: "",
    authorKey: "",
    awemeId: "",
    exposureIndex: 0,
    exposedAt: null,
    itemType: "unknown",
    skipped: false,
    skipReason: "",
    duplicateInRun: false,
    advanceMethod: "native",
    transitionMode: "",
    waitSeconds: 0,
    transitionConfirmedAt: null,
    analysisStatus: "pending",
    snapshot: {},
    rawJson: {},
  },
});
