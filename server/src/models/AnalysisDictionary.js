import { createLiteModel } from "../storage/liteModel.js";

export const AnalysisDictionary = createLiteModel({
  modelName: "AnalysisDictionary",
  tableName: "analysis_dictionaries",
  uniqueFields: ["name"],
  defaults: {
    name: "default",
    targetWords: [],
    strongSignalWords: [],
    stopWords: [],
    synonymMap: {},
    weights: {
      content: 0.2,
      commentKeyword: 0.3,
      topComment: 0.3,
      consistency: 0.2,
    },
  },
});
