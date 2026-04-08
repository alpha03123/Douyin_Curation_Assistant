import { createLiteModel } from "../storage/liteModel.js";

export const ActionRule = createLiteModel({
  modelName: "ActionRule",
  tableName: "action_rules",
  uniqueFields: ["name"],
  populate: {
    "commentStrategy.templateIds": "CommentTemplate",
  },
  defaults: {
    name: "",
    description: "",
    enabled: true,
    priority: 0,
    actions: [],
    conditions: {
      minDiggCount: null,
      minCommentCount: null,
      minCollectCount: null,
      minShareCount: null,
      minTotalScore: null,
      minCommentKeywordScore: null,
      minTopCommentScore: null,
      minTop10KeywordHitRate: null,
      keywordIncludes: [],
      keywordExcludes: [],
      contentTypes: [],
      creatorReviewStatuses: [],
    },
    commentStrategy: {
      mode: "disabled",
      templateIds: [],
    },
    executionPolicy: {
      reviewMode: "manual_review",
    },
  },
});
