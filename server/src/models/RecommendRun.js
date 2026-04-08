import { createLiteModel } from "../storage/liteModel.js";

export const RecommendRun = createLiteModel({
  modelName: "RecommendRun",
  tableName: "recommend_runs",
  defaults: {
    status: "running",
    targetUrl: "https://www.douyin.com/?recommend=1",
    headless: false,
    commentLimit: 30,
    maxItems: 50,
    maxDurationMs: 1800000,
    skipLive: true,
    preferNativeAutoplay: true,
    nativeAutoplayMaxSeconds: 120,
    manualAdvanceBaseSeconds: 10,
    manualAdvanceJitterSeconds: 2,
    startedAt: null,
    endedAt: null,
    lastHeartbeatAt: null,
    stopReason: "",
    totals: {
      seenCount: 0,
      uniqueCount: 0,
      duplicateCount: 0,
      liveSkippedCount: 0,
      analyzedCount: 0,
      failedCount: 0,
    },
    config: {},
    summary: {},
  },
});
