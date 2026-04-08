import { z } from "zod";
import {
  executeCandidateWorkDirectAction,
  executeRecommendWorkDirectAction,
} from "../services/actions/directActionService.js";

const directActionSchema = z.object({
  actionType: z.enum(["like", "collect", "follow", "comment"]),
  commentText: z.string().optional(),
  headless: z.boolean().default(false),
});

export async function runCandidateWorkDirectAction(req, res, next) {
  try {
    const payload = directActionSchema.parse(req.body || {});
    const result = await executeCandidateWorkDirectAction(req.params.workId, payload, payload);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
}

export async function runRecommendWorkDirectAction(req, res, next) {
  try {
    const payload = directActionSchema.parse(req.body || {});
    const result = await executeRecommendWorkDirectAction(req.params.workId, payload, payload);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
}
