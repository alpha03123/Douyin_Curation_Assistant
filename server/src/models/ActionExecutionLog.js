import { createLiteModel } from "../storage/liteModel.js";

export const ActionExecutionLog = createLiteModel({
  modelName: "ActionExecutionLog",
  tableName: "action_execution_logs",
  defaults: {
    taskId: "",
    workId: null,
    actionType: "",
    level: "info",
    phase: "general",
    message: "",
    details: null,
  },
});
