import { RecommendAuthorProfile } from "../models/RecommendAuthorProfile.js";
import { RecommendAuthorSnapshot } from "../models/RecommendAuthorSnapshot.js";
import { RecommendWork } from "../models/RecommendWork.js";

function escapeRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SORT_FIELD_MAP = {
  lastSeenAt: "lastSeenAt",
  followerCount: "followerCount",
  totalFavorited: "totalFavorited",
  awemeCount: "awemeCount",
  seenWorkCount: "seenWorkCount",
  seenExposureCount: "seenExposureCount",
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

function applyRangeFilter(filter, field, minValue, maxValue) {
  const hasMin = minValue !== undefined && minValue !== null && minValue !== "";
  const hasMax = maxValue !== undefined && maxValue !== null && maxValue !== "";
  if (!hasMin && !hasMax) {
    return;
  }

  filter[field] = {};
  if (hasMin) {
    filter[field].$gte = Number(minValue);
  }
  if (hasMax) {
    filter[field].$lte = Number(maxValue);
  }
}

export async function listRecommendAuthors(req, res, next) {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 200));
    const filter = {};

    if (req.query.keyword) {
      const keywordRegex = new RegExp(escapeRegex(req.query.keyword), "i");
      filter.$or = [
        { authorNickname: keywordRegex },
        { authorKey: keywordRegex },
        { authorUniqueId: keywordRegex },
        { authorSignature: keywordRegex },
      ];
    }

    applyRangeFilter(filter, "followerCount", req.query.minFollowerCount, req.query.maxFollowerCount);
    applyRangeFilter(filter, "awemeCount", req.query.minAwemeCount, req.query.maxAwemeCount);
    applyRangeFilter(filter, "seenWorkCount", req.query.minSeenWorkCount, req.query.maxSeenWorkCount);
    applyRangeFilter(
      filter,
      "seenExposureCount",
      req.query.minSeenExposureCount,
      req.query.maxSeenExposureCount
    );

    const sortBy = SORT_FIELD_MAP[req.query.sortBy] || "lastSeenAt";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
    const items = sortItems(
      await RecommendAuthorProfile.find(filter),
      sortBy,
      req.query.sortOrder || "desc"
    ).slice(0, limit);

    res.json({ data: items });
  } catch (error) {
    next(error);
  }
}

export async function getRecommendAuthorDetail(req, res, next) {
  try {
    const author = await RecommendAuthorProfile.findById(req.params.authorId);
    if (!author) {
      const error = new Error("Recommend author not found.");
      error.statusCode = 404;
      throw error;
    }

    const [works, snapshots] = await Promise.all([
      RecommendWork.find({ authorKey: author.authorKey })
        .sort({ lastSeenAt: -1, updatedAt: -1 })
        .limit(30),
      RecommendAuthorSnapshot.find({ authorKey: author.authorKey })
        .sort({ capturedAt: -1, createdAt: -1 })
        .limit(30),
    ]);

    res.json({
      data: {
        author,
        works,
        snapshots,
      },
    });
  } catch (error) {
    next(error);
  }
}
