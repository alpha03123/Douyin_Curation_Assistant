import { z } from "zod";
import {
  analyzeLatestWorks,
  analyzeWorkComments,
  getWorkCommentAnalysis,
} from "../services/analysis/commentAnalysisService.js";

const workAnalysisSchema = z.object({
  commentLimit: z.number().int().min(5).max(100).optional(),
});

const batchAnalysisSchema = z.object({
  limit: z.number().int().min(1).max(50).optional(),
  keyword: z.string().optional(),
  commentLimit: z.number().int().min(5).max(100).optional(),
});

export async function getAnalysisForWork(req, res, next) {
  try {
    const result = await getWorkCommentAnalysis(req.params.workId);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
}

export async function runAnalysisForWork(req, res, next) {
  try {
    const payload = workAnalysisSchema.parse(req.body || {});
    const result = await analyzeWorkComments(req.params.workId, payload);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
}

export async function runBatchAnalysis(req, res, next) {
  try {
    const payload = batchAnalysisSchema.parse(req.body || {});
    const result = await analyzeLatestWorks(payload);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
}
