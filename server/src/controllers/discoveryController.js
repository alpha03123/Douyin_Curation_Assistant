import { z } from "zod";
import { discoverWorksByKeywordId } from "../services/discovery/discoveryService.js";

const discoverSchema = z.object({
  requireNum: z.coerce.number().int().positive().max(100).optional(),
  sortType: z.string().optional(),
  publishTime: z.string().optional(),
  filterDuration: z.string().optional(),
  searchRange: z.string().optional(),
  contentType: z.string().optional(),
  searchStrategy: z.enum(["auto", "fast", "safe"]).optional(),
});

export async function discoverWorksByKeyword(req, res, next) {
  try {
    const payload = discoverSchema.parse(req.body || {});
    const result = await discoverWorksByKeywordId(req.params.keywordId, payload);

    res.status(201).json({
      data: result,
    });
  } catch (error) {
    next(error);
  }
}
