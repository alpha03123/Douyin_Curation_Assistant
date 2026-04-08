import { createLiteModel } from "../storage/liteModel.js";

export const RecommendAuthorSnapshot = createLiteModel({
  modelName: "RecommendAuthorSnapshot",
  tableName: "recommend_author_snapshots",
  defaults: {
    authorKey: "",
    runId: "",
    recommendWorkId: "",
    capturedAt: null,
    followerCount: 0,
    followingCount: 0,
    awemeCount: 0,
    totalFavorited: 0,
    authorSignature: "",
    rawJson: {},
  },
});
