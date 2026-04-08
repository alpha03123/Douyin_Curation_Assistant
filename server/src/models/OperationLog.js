import { createLiteModel } from "../storage/liteModel.js";

export const OperationLog = createLiteModel({
  modelName: "OperationLog",
  tableName: "operation_logs",
  defaults: {
    taskType: "",
    status: "info",
    message: "",
    payload: null,
  },
});
