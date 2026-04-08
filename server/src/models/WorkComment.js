import { createLiteModel } from "../storage/liteModel.js";

export const WorkComment = createLiteModel({
  modelName: "WorkComment",
  tableName: "work_comments",
  uniqueFields: ["commentId"],
  defaults: {
    work: "",
    awemeId: "",
    commentId: "",
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
    sourceKeyword: "",
    rawJson: {},
  },
});
