import { createLiteModel } from "../storage/liteModel.js";

export const RecommendComment = createLiteModel({
  modelName: "RecommendComment",
  tableName: "recommend_comments",
  uniqueFields: ["commentKey"],
  defaults: {
    recommendWorkId: "",
    authorKey: "",
    awemeId: "",
    commentId: "",
    commentKey: "",
    text: "",
    cleanText: "",
    diggCount: 0,
    replyCount: 0,
    isTopComment: false,
    commentCreatedAt: null,
    author: {
      userId: "",
      uniqueId: "",
      secUid: "",
      nickname: "",
    },
    rawJson: {},
  },
});
