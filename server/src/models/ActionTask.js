import { createLiteModel } from "../storage/liteModel.js";

export const ActionTask = createLiteModel({
  modelName: "ActionTask",
  tableName: "action_tasks",
  populate: {
    workId: "Work",
    ruleId: "ActionRule",
    commentTemplateId: "CommentTemplate",
  },
  defaults: {
    workId: "",
    ruleId: null,
    actionType: "",
    commentTemplateId: null,
    reviewStatus: "pending",
    executeStatus: "idle",
    draftText: "",
    errorMessage: "",
    reasonSummary: "",
    matchedSnapshot: null,
    plannedAt: null,
    executedAt: null,
  },
});
