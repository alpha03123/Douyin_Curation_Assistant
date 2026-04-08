import { createLiteModel } from "../storage/liteModel.js";

export const Keyword = createLiteModel({
  modelName: "Keyword",
  tableName: "keywords",
  uniqueFields: ["keyword"],
  defaults: {
    keyword: "",
    enabled: true,
    dailyLimit: 50,
    note: "",
  },
});
