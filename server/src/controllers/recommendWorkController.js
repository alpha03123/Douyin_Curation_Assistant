import { RecommendAuthorProfile } from "../models/RecommendAuthorProfile.js";
import { RecommendComment } from "../models/RecommendComment.js";
import { RecommendCommentAnalysis } from "../models/RecommendCommentAnalysis.js";
import { RecommendExposure } from "../models/RecommendExposure.js";
import { RecommendWork } from "../models/RecommendWork.js";
import { z } from "zod";
import { batchDeleteRecommendWorks } from "../services/recommend/recommendCleanupService.js";

function escapeRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SORT_FIELD_MAP = {
  lastSeenAt: "lastSeenAt",
  publishAt: "publishAt",
  diggCount: "diggCount",
  commentCount: "commentCount",
  collectCount: "collectCount",
  shareCount: "shareCount",
  followerCount: "followerCount",
  seenCount: "seenCount",
  latestAnalysisScore: "latestAnalysisScore",
};

function normalizeSortValue(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const asDate = new Date(value);
    if (!Number.isNaN(asDate.getTime())) {
      return asDate.getTime();
    }

    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) {
      return asNumber;
    }

    return value;
  }

  return null;
}

function sortItems(items, field, sortOrder) {
  const direction = sortOrder === "asc" ? 1 : -1;
  return items.sort((left, right) => {
    const leftValue = normalizeSortValue(left?.[field]);
    const rightValue = normalizeSortValue(right?.[field]);

    if (leftValue === rightValue) {
      const leftUpdated = normalizeSortValue(left?.updatedAt) || 0;
      const rightUpdated = normalizeSortValue(right?.updatedAt) || 0;
      return (rightUpdated - leftUpdated) * direction;
    }

    if (leftValue === null) {
      return 1;
    }
    if (rightValue === null) {
      return -1;
    }

    if (typeof leftValue === "number" && typeof rightValue === "number") {
      return (leftValue - rightValue) * direction;
    }

    return String(leftValue).localeCompare(String(rightValue)) * direction;
  });
}

function normalizeIsoDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString();
}

function applyRangeFilter(filter, field, minValue, maxValue, transformer = Number) {
  const hasMin = minValue !== undefined && minValue !== null && minValue !== "";
  const hasMax = maxValue !== undefined && maxValue !== null && maxValue !== "";
  if (!hasMin && !hasMax) {
    return;
  }

  filter[field] = {};
  if (hasMin) {
    filter[field].$gte = transformer(minValue);
  }
  if (hasMax) {
    filter[field].$lte = transformer(maxValue);
  }
}

const batchDeleteSchema = z.object({
  workIds: z.array(z.string().min(1)).min(1),
});

export async function listRecommendWorks(req, res, next) {
  try {
    const {
      keyword,
      authorKeyword,
      runId,
      workType,
      dateFrom,
      dateTo,
      publishFrom,
      publishTo,
      sortBy = "lastSeenAt",
      sortOrder = "desc",
    } = req.query;
    const limit = Math.min(Number(req.query.limit || 100), 200);
    const includeAnalysis =
      req.query.includeAnalysis === "1" || req.query.includeAnalysis === "true";
    const filter = {};

    if (keyword) {
      const keywordRegex = new RegExp(escapeRegex(keyword), "i");
      filter.$or = [
        { title: keywordRegex },
        { desc: keywordRegex },
        { topics: keywordRegex },
        { authorNickname: keywordRegex },
      ];
    }

    if (authorKeyword) {
      const authorRegex = new RegExp(escapeRegex(authorKeyword), "i");
      filter.$or = [
        ...(filter.$or || []),
        { authorNickname: authorRegex },
        { authorUniqueId: authorRegex },
        { authorSecUid: authorRegex },
        { authorSignature: authorRegex },
      ];
    }

    if (runId) {
      filter.lastRunId = String(runId);
    }

    if (workType) {
      filter.workType = String(workType);
    }

    const normalizedDateFrom = normalizeIsoDate(dateFrom);
    const normalizedDateTo = normalizeIsoDate(dateTo);
    if (normalizedDateFrom || normalizedDateTo) {
      filter.lastSeenAt = {};
      if (normalizedDateFrom) {
        filter.lastSeenAt.$gte = normalizedDateFrom;
      }
      if (normalizedDateTo) {
        filter.lastSeenAt.$lte = normalizedDateTo;
      }
    }

    const normalizedPublishFrom = normalizeIsoDate(publishFrom);
    const normalizedPublishTo = normalizeIsoDate(publishTo);
    if (normalizedPublishFrom || normalizedPublishTo) {
      filter.publishAt = {};
      if (normalizedPublishFrom) {
        filter.publishAt.$gte = normalizedPublishFrom;
      }
      if (normalizedPublishTo) {
        filter.publishAt.$lte = normalizedPublishTo;
      }
    }

    applyRangeFilter(filter, "followerCount", req.query.minFollowerCount, req.query.maxFollowerCount);
    applyRangeFilter(filter, "diggCount", req.query.minDiggCount, req.query.maxDiggCount);
    applyRangeFilter(filter, "commentCount", req.query.minCommentCount, req.query.maxCommentCount);
    applyRangeFilter(filter, "collectCount", req.query.minCollectCount, req.query.maxCollectCount);
    applyRangeFilter(filter, "shareCount", req.query.minShareCount, req.query.maxShareCount);
    applyRangeFilter(filter, "durationSeconds", req.query.minDurationSeconds, req.query.maxDurationSeconds);
    applyRangeFilter(filter, "seenCount", req.query.minSeenCount, req.query.maxSeenCount);

    const normalizedSortField = SORT_FIELD_MAP[sortBy] || "lastSeenAt";
    const normalizedSortOrder = sortOrder === "asc" ? 1 : -1;
    const sortConfig = {
      [normalizedSortField]: normalizedSortOrder,
      lastSeenAt: -1,
      updatedAt: -1,
    };

    const items = sortItems(
      await RecommendWork.find(filter),
      normalizedSortField,
      sortOrder
    ).slice(0, limit);

    if (!includeAnalysis || items.length === 0) {
      res.json({ data: items });
      return;
    }

    const [analyses, authorProfiles, exposures] = await Promise.all([
      RecommendCommentAnalysis.find({
        recommendWorkId: { $in: items.map((item) => item._id) },
      }),
      RecommendAuthorProfile.find({
        authorKey: { $in: items.map((item) => item.authorKey).filter(Boolean) },
      }),
      RecommendExposure.find({
        recommendWorkId: { $in: items.map((item) => item._id) },
      }),
    ]);

    const analysisByWorkId = new Map(
      analyses.map((analysis) => [String(analysis.recommendWorkId), analysis])
    );
    const authorProfileByKey = new Map(
      authorProfiles.map((profile) => [String(profile.authorKey), profile])
    );
    const exposureCountMap = new Map();

    for (const exposure of exposures) {
      const workId = String(exposure.recommendWorkId || "");
      if (!workId) {
        continue;
      }
      exposureCountMap.set(workId, (exposureCountMap.get(workId) || 0) + 1);
    }

    const responseItems = items.map((item) => {
      const plainItem = item.toObject();
      const analysis = analysisByWorkId.get(String(item._id));
      const authorProfile = authorProfileByKey.get(String(item.authorKey));

      plainItem.analysisSummary = analysis
        ? {
            sampledCommentCount: analysis.sampledCommentCount,
            generatedAt: analysis.generatedAt,
            totalScore: analysis?.scores?.totalScore || 0,
            top10KeywordHitRate: analysis?.keywordHits?.top10KeywordHitRate || 0,
          }
        : null;
      plainItem.authorSummary = authorProfile
        ? {
            authorKey: authorProfile.authorKey,
            seenWorkCount: authorProfile.seenWorkCount,
            seenExposureCount: authorProfile.seenExposureCount,
            topTopics: authorProfile.topTopics || [],
            topKeywords: authorProfile.topKeywords || [],
          }
        : null;
      plainItem.exposureCount = exposureCountMap.get(String(item._id)) || 0;

      return plainItem;
    });

    res.json({ data: responseItems });
  } catch (error) {
    next(error);
  }
}

export async function getRecommendWorkDetail(req, res, next) {
  try {
    const work = await RecommendWork.findById(req.params.workId);
    if (!work) {
      const error = new Error("Recommend work not found.");
      error.statusCode = 404;
      throw error;
    }

    const [analysis, comments, exposures, authorProfile] = await Promise.all([
      RecommendCommentAnalysis.findOne({ recommendWorkId: work._id }),
      RecommendComment.find({ recommendWorkId: work._id })
        .sort({ diggCount: -1, createdAt: -1 })
        .limit(20),
      RecommendExposure.find({ recommendWorkId: work._id })
        .sort({ exposedAt: -1 })
        .limit(20),
      work.authorKey
        ? RecommendAuthorProfile.findOne({ authorKey: work.authorKey })
        : Promise.resolve(null),
    ]);

    res.json({
      data: {
        work,
        analysis,
        comments,
        exposures,
        authorProfile,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function batchDeleteRecommendWorksController(req, res, next) {
  try {
    const payload = batchDeleteSchema.parse(req.body || {});
    const result = await batchDeleteRecommendWorks(payload.workIds);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
}
