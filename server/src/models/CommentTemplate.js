import { createLiteModel } from "../storage/liteModel.js";

export const CommentTemplate = createLiteModel({
  modelName: "CommentTemplate",
  tableName: "comment_templates",
  defaults: {
    content: "",
    enabled: true,
    priority: 0,
  },
});
