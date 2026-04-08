import { RecommendAuthorProfile } from "../../models/RecommendAuthorProfile.js";
import { RecommendAuthorSnapshot } from "../../models/RecommendAuthorSnapshot.js";
import { RecommendCommentAnalysis } from "../../models/RecommendCommentAnalysis.js";
import { RecommendWork } from "../../models/RecommendWork.js";

function buildCountList(counterMap, limit = 10) {
  return [...counterMap.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((left, right) => right.count - left.count || left.word.localeCompare(right.word))
    .slice(0, limit);
}

function nowIso() {
  return new Date().toISOString();
}

function incrementCounter(counterMap, word, count = 1) {
  if (!word) {
    return;
  }

  counterMap.set(word, (counterMap.get(word) || 0) + count);
}

export function buildRecommendAuthorKey(value = {}) {
  if (value?.authorSecUid) {
    return `sec_uid:${String(value.authorSecUid).trim()}`;
  }

  if (value?.authorUniqueId) {
    return `unique_id:${String(value.authorUniqueId).trim()}`;
  }

  if (value?.userUrl) {
    return `user_url:${String(value.userUrl).trim()}`;
  }

  if (value?.authorNickname) {
    return `nickname:${String(value.authorNickname).trim()}`;
  }

  return "";
}

function pickTopTopics(works = []) {
  const counter = new Map();
  for (const work of works) {
    for (const topic of work.topics || []) {
      incrementCounter(counter, String(topic || "").trim());
    }
  }

  return buildCountList(counter, 10);
}

function pickTopKeywords(analyses = []) {
  const counter = new Map();
  for (const analysis of analyses) {
    for (const item of analysis.matchedKeywords || []) {
      incrementCounter(counter, String(item || "").trim());
    }
  }

  return buildCountList(counter, 12);
}

export async function rebuildRecommendAuthorProfile(authorKey) {
  const safeAuthorKey = String(authorKey || "").trim();
  if (!safeAuthorKey) {
    return null;
  }

  const works = await RecommendWork.find({ authorKey: safeAuthorKey }).sort({
    lastSeenAt: -1,
    updatedAt: -1,
  });
  if (works.length === 0) {
    return null;
  }

  const analyses = await RecommendCommentAnalysis.find({
    recommendWorkId: {
      $in: works.map((item) => item._id),
    },
  });

  const latestWork = works[0];
  const seenExposureCount = works.reduce(
    (sum, item) => sum + Number(item.seenCount || 0),
    0
  );

  return RecommendAuthorProfile.findOneAndUpdate(
    { authorKey: safeAuthorKey },
    {
      $set: {
        authorKey: safeAuthorKey,
        authorUid: latestWork.authorUid || "",
        authorSecUid: latestWork.authorSecUid || "",
        authorUniqueId: latestWork.authorUniqueId || "",
        authorShortId: latestWork.authorShortId || "",
        authorNickname: latestWork.authorNickname || "",
        authorAvatar: latestWork.authorAvatar || "",
        authorSignature: latestWork.authorSignature || "",
        authorCustomVerify: latestWork.authorCustomVerify || "",
        authorEnterpriseVerifyReason: latestWork.authorEnterpriseVerifyReason || "",
        authorVerificationType: Number(latestWork.authorVerificationType || 0),
        userUrl: latestWork.userUrl || "",
        followingCount: Number(latestWork.followingCount || 0),
        followerCount: Number(latestWork.followerCount || 0),
        totalFavorited: Number(latestWork.totalFavorited || 0),
        awemeCount: Number(latestWork.awemeCount || 0),
        userAge:
          latestWork.userAge === undefined || latestWork.userAge === null
            ? null
            : Number(latestWork.userAge),
        gender: latestWork.gender || "unknown",
        ipLocation: latestWork.ipLocation || "",
        country: latestWork.country || "",
        province: latestWork.province || "",
        city: latestWork.city || "",
        district: latestWork.district || "",
        firstSeenAt:
          works
            .map((item) => item.firstSeenAt)
            .filter(Boolean)
            .sort()[0] || latestWork.firstSeenAt || null,
        lastSeenAt: latestWork.lastSeenAt || null,
        seenWorkCount: works.length,
        seenExposureCount,
        sampleWorkIds: works.slice(0, 8).map((item) => String(item._id)),
        topTopics: pickTopTopics(works),
        topKeywords: pickTopKeywords(analyses),
        rawAuthorJson: latestWork.rawDetailJson?.author || {},
      },
    },
    {
      new: true,
      upsert: true,
    }
  );
}

export async function upsertRecommendAuthorProfileFromWork(work, runId, options = {}) {
  if (!work) {
    return null;
  }

  const authorKey = buildRecommendAuthorKey(work);
  if (!authorKey) {
    return null;
  }

  await RecommendAuthorSnapshot.create({
    authorKey,
    runId: String(runId || ""),
    recommendWorkId: String(work._id || ""),
    capturedAt: nowIso(),
    followerCount: Number(work.followerCount || 0),
    followingCount: Number(work.followingCount || 0),
    awemeCount: Number(work.awemeCount || 0),
    totalFavorited: Number(work.totalFavorited || 0),
    authorSignature: work.authorSignature || "",
    rawJson: {
      author: work.rawDetailJson?.author || {},
      source: options.source || "recommend_work",
    },
  });

  return rebuildRecommendAuthorProfile(authorKey);
}
