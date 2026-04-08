import { z } from "zod";
import { CreatorProfile } from "../models/CreatorProfile.js";
import { getAnalysisDictionary } from "../services/analysis/dictionaryService.js";
import { rebuildCreatorProfilesFromAnalyses } from "../services/analysis/creatorScoringService.js";

const creatorRebuildSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
  keyword: z.string().optional(),
});

const creatorUpdateSchema = z
  .object({
    reviewStatus: z.enum(["new", "reviewing", "approved", "rejected"]).optional(),
    reviewNote: z.string().optional(),
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: "At least one field is required.",
  });

function escapeRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function listCreatorCandidates(req, res, next) {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 200));
    const filter = {};

    if (req.query.reviewStatus) {
      filter.reviewStatus = req.query.reviewStatus;
    }

    if (req.query.candidateLevel) {
      filter.candidateLevel = req.query.candidateLevel;
    }

    if (req.query.keyword) {
      const keywordRegex = new RegExp(escapeRegex(req.query.keyword), "i");
      filter.$or = [
        { nickname: keywordRegex },
        { creatorKey: keywordRegex },
        { userDesc: keywordRegex },
        { keywordSources: keywordRegex },
      ];
    }

    const items = await CreatorProfile.find(filter)
      .sort({ totalScore: -1, updatedAt: -1 })
      .limit(limit);
    res.json({ data: items });
  } catch (error) {
    next(error);
  }
}

export async function rebuildCreatorCandidates(req, res, next) {
  try {
    const payload = creatorRebuildSchema.parse(req.body || {});
    const dictionary = await getAnalysisDictionary();
    const items = await rebuildCreatorProfilesFromAnalyses(dictionary, payload);
    res.json({ data: items });
  } catch (error) {
    next(error);
  }
}

export async function updateCreatorCandidate(req, res, next) {
  try {
    const payload = creatorUpdateSchema.parse(req.body || {});
    const item = await CreatorProfile.findByIdAndUpdate(
      req.params.creatorId,
      payload,
      {
        new: true,
        runValidators: true,
      }
    );

    if (!item) {
      const error = new Error("Creator candidate not found.");
      error.statusCode = 404;
      throw error;
    }

    res.json({ data: item });
  } catch (error) {
    next(error);
  }
}
