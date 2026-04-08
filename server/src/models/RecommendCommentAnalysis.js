import { createLiteModel } from "../storage/liteModel.js";

export const RecommendCommentAnalysis = createLiteModel({
  modelName: "RecommendCommentAnalysis",
  tableName: "recommend_comment_analyses",
  uniqueFields: ["recommendWorkId"],
  defaults: {
    recommendWorkId: "",
    awemeId: "",
    authorKey: "",
    sampledCommentCount: 0,
    topComments: [],
    wordCloud: [],
    keywordHits: {
      target: [],
      strong: [],
      totalTargetCount: 0,
      totalStrongCount: 0,
      top10KeywordHitCount: 0,
      top10KeywordHitRate: 0,
    },
    matchedKeywords: [],
    scores: {
      contentScore: 0,
      commentKeywordScore: 0,
      topCommentScore: 0,
      totalScore: 0,
    },
    generatedAt: null,
  },
});
