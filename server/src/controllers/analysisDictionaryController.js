import { z } from "zod";
import {
  getDictionaryWordCloudSuggestions,
  getAnalysisDictionary,
  updateAnalysisDictionary,
} from "../services/analysis/dictionaryService.js";

const dictionaryUpdateSchema = z
  .object({
    targetWords: z.array(z.string()).optional(),
    strongSignalWords: z.array(z.string()).optional(),
    stopWords: z.array(z.string()).optional(),
    synonymMap: z.record(z.array(z.string())).optional(),
    weights: z
      .object({
        content: z.number().nonnegative().optional(),
        commentKeyword: z.number().nonnegative().optional(),
        topComment: z.number().nonnegative().optional(),
        consistency: z.number().nonnegative().optional(),
      })
      .optional(),
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: "At least one field is required.",
  });

const dictionaryWordCloudQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(300).optional(),
  minCount: z.coerce.number().int().min(1).optional(),
  keyword: z.string().optional(),
});

export async function getDictionary(req, res, next) {
  try {
    const dictionary = await getAnalysisDictionary();
    res.json({ data: dictionary });
  } catch (error) {
    next(error);
  }
}

export async function getDictionaryWordCloud(req, res, next) {
  try {
    const query = dictionaryWordCloudQuerySchema.parse(req.query || {});
    const suggestions = await getDictionaryWordCloudSuggestions(query);
    res.json({ data: suggestions });
  } catch (error) {
    next(error);
  }
}

export async function saveDictionary(req, res, next) {
  try {
    const payload = dictionaryUpdateSchema.parse(req.body || {});
    const dictionary = await updateAnalysisDictionary(payload);
    res.json({ data: dictionary });
  } catch (error) {
    next(error);
  }
}
