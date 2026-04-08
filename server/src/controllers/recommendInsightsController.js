import { RecommendAuthorProfile } from "../models/RecommendAuthorProfile.js";
import { RecommendCommentAnalysis } from "../models/RecommendCommentAnalysis.js";
import { RecommendWork } from "../models/RecommendWork.js";

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

function isIsoInRange(value, fromIso, toIso) {
  const safeValue = String(value || "").trim();
  if (!safeValue) {
    return false;
  }

  if (fromIso && safeValue < fromIso) {
    return false;
  }

  if (toIso && safeValue > toIso) {
    return false;
  }

  return true;
}

function toSafeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareIsoDesc(leftValue, rightValue) {
  return String(rightValue || "").localeCompare(String(leftValue || ""));
}

function incrementCounter(counterMap, word, count = 1) {
  const safeWord = String(word || "").trim();
  if (!safeWord) {
    return;
  }

  counterMap.set(safeWord, (counterMap.get(safeWord) || 0) + count);
}

function buildCountList(counterMap, limit = 20, minimumCount = 1) {
  return [...counterMap.entries()]
    .filter(([, count]) => count >= minimumCount)
    .map(([word, count]) => ({ word, count }))
    .sort((left, right) => right.count - left.count || left.word.localeCompare(right.word))
    .slice(0, limit);
}

function buildTopLikedWorks(works = [], analysisByWorkId = new Map(), limit = 20) {
  return works
    .map((work) => ({
      workId: String(work._id || ""),
      awemeId: work.awemeId || "",
      workUrl: work.workUrl || "",
      title: work.title || work.desc || work.awemeId || "",
      authorNickname: work.authorNickname || "",
      workType: work.workType || "unknown",
      diggCount: toSafeNumber(work.diggCount),
      commentCount: toSafeNumber(work.commentCount),
      collectCount: toSafeNumber(work.collectCount),
      shareCount: toSafeNumber(work.shareCount),
      seenCount: toSafeNumber(work.seenCount),
      followerCount: toSafeNumber(work.followerCount),
      latestAnalysisScore: toSafeNumber(
        analysisByWorkId.get(String(work._id || ""))?.scores?.totalScore ||
          work.latestAnalysisScore
      ),
      publishAt: work.publishAt || null,
      lastSeenAt: work.lastSeenAt || null,
      topics: Array.isArray(work.topics) ? work.topics.filter(Boolean) : [],
    }))
    .sort(
      (left, right) =>
        right.diggCount - left.diggCount ||
        right.commentCount - left.commentCount ||
        right.collectCount - left.collectCount ||
        right.seenCount - left.seenCount ||
        compareIsoDesc(left.lastSeenAt, right.lastSeenAt)
    )
    .slice(0, limit);
}

function buildGlobalCommentWordCloud(analyses = [], limit = 80) {
  const counter = new Map();
  const workCoverageMap = new Map();

  for (const analysis of analyses) {
    const workId = String(analysis.recommendWorkId || "");
    for (const item of analysis.wordCloud || []) {
      const word = String(item.word || "").trim();
      if (!word) {
        continue;
      }

      incrementCounter(counter, word, Number(item.count || 1));
      if (!workCoverageMap.has(word)) {
        workCoverageMap.set(word, new Set());
      }
      if (workId) {
        workCoverageMap.get(word).add(workId);
      }
    }
  }

  return buildCountList(counter, limit, 2).map((item) => ({
    ...item,
    workCount: workCoverageMap.get(item.word)?.size || 0,
  }));
}

function buildGlobalTopCommentSamples(analyses = [], workById = new Map(), limit = 24) {
  const seen = new Set();
  const items = [];

  for (const analysis of analyses) {
    const workId = String(analysis.recommendWorkId || "");
    const work = workById.get(workId);
    for (const comment of analysis.topComments || []) {
      const commentId = String(comment.commentId || "");
      const uniqueKey = `${workId}:${commentId}`;
      if (!commentId || seen.has(uniqueKey)) {
        continue;
      }

      seen.add(uniqueKey);
      items.push({
        commentId,
        workId,
        workUrl: work?.workUrl || "",
        workTitle: work?.title || work?.awemeId || "",
        workAuthorNickname: work?.authorNickname || "",
        workTopics: Array.isArray(work?.topics) ? work.topics.filter(Boolean) : [],
        latestAnalysisScore: toSafeNumber(analysis?.scores?.totalScore),
        text: comment.text || "",
        diggCount: toSafeNumber(comment.diggCount),
        replyCount: toSafeNumber(comment.replyCount),
        authorName: comment.authorName || "",
      });
    }
  }

  return items
    .sort(
      (left, right) =>
        right.diggCount - left.diggCount ||
        right.replyCount - left.replyCount ||
        right.latestAnalysisScore - left.latestAnalysisScore
    )
    .slice(0, limit);
}

function buildTopicAggregates(works = [], analyses = [], authorProfiles = []) {
  const analysisByWorkId = new Map(
    analyses.map((analysis) => [String(analysis.recommendWorkId || ""), analysis])
  );
  const authorProfileByKey = new Map(
    authorProfiles.map((profile) => [String(profile.authorKey || ""), profile])
  );
  const topicMap = new Map();

  const ensureBucket = (topic) => {
    const safeTopic = String(topic || "").trim();
    if (!safeTopic) {
      return null;
    }

    if (!topicMap.has(safeTopic)) {
      topicMap.set(safeTopic, {
        topic: safeTopic,
        workIds: new Set(),
        authorKeys: new Set(),
        totalDiggCount: 0,
        totalCommentCount: 0,
        totalCollectCount: 0,
        totalShareCount: 0,
        totalSeenCount: 0,
        lastSeenAt: "",
        works: [],
        authorStats: new Map(),
        commentWordCounter: new Map(),
        commentSamples: [],
      });
    }

    return topicMap.get(safeTopic);
  };

  for (const work of works) {
    const workId = String(work._id || "");
    const uniqueTopics = [...new Set((work.topics || []).map((item) => String(item || "").trim()).filter(Boolean))];
    const analysis = analysisByWorkId.get(workId);
    const authorKey = String(work.authorKey || "").trim();

    for (const topic of uniqueTopics) {
      const bucket = ensureBucket(topic);
      if (!bucket) {
        continue;
      }

      bucket.workIds.add(workId);
      if (authorKey) {
        bucket.authorKeys.add(authorKey);
      }
      bucket.totalDiggCount += toSafeNumber(work.diggCount);
      bucket.totalCommentCount += toSafeNumber(work.commentCount);
      bucket.totalCollectCount += toSafeNumber(work.collectCount);
      bucket.totalShareCount += toSafeNumber(work.shareCount);
      bucket.totalSeenCount += toSafeNumber(work.seenCount);
      if (!bucket.lastSeenAt || String(work.lastSeenAt || "") > bucket.lastSeenAt) {
        bucket.lastSeenAt = String(work.lastSeenAt || "");
      }
      bucket.works.push(work);

      if (authorKey) {
        if (!bucket.authorStats.has(authorKey)) {
          bucket.authorStats.set(authorKey, {
            authorKey,
            authorNickname: work.authorNickname || "",
            followerCount: toSafeNumber(work.followerCount),
            workCount: 0,
            totalSeenCount: 0,
            lastSeenAt: "",
          });
        }
        const authorStats = bucket.authorStats.get(authorKey);
        authorStats.workCount += 1;
        authorStats.totalSeenCount += toSafeNumber(work.seenCount);
        authorStats.followerCount = Math.max(
          authorStats.followerCount,
          toSafeNumber(work.followerCount)
        );
        if (!authorStats.lastSeenAt || String(work.lastSeenAt || "") > authorStats.lastSeenAt) {
          authorStats.lastSeenAt = String(work.lastSeenAt || "");
        }
      }

      if (analysis) {
        for (const item of analysis.wordCloud || []) {
          incrementCounter(bucket.commentWordCounter, item.word, Number(item.count || 1));
        }

        for (const comment of analysis.topComments || []) {
          bucket.commentSamples.push({
            commentId: String(comment.commentId || ""),
            workId,
            workTitle: work.title || work.awemeId || "",
            workAuthorNickname: work.authorNickname || "",
            text: comment.text || "",
            diggCount: toSafeNumber(comment.diggCount),
            replyCount: toSafeNumber(comment.replyCount),
            authorName: comment.authorName || "",
          });
        }
      }
    }
  }

  const allTopics = [...topicMap.values()];
  const topTopics = allTopics
    .map((bucket) => ({
      topic: bucket.topic,
      count: bucket.workIds.size,
      workCount: bucket.workIds.size,
      authorCount: bucket.authorKeys.size,
      averageDiggCount:
        bucket.workIds.size > 0 ? Math.round(bucket.totalDiggCount / bucket.workIds.size) : 0,
      averageCommentCount:
        bucket.workIds.size > 0 ? Math.round(bucket.totalCommentCount / bucket.workIds.size) : 0,
      averageCollectCount:
        bucket.workIds.size > 0 ? Math.round(bucket.totalCollectCount / bucket.workIds.size) : 0,
      totalSeenCount: bucket.totalSeenCount,
      lastSeenAt: bucket.lastSeenAt || null,
    }))
    .sort(
      (left, right) =>
        right.workCount - left.workCount ||
        right.totalSeenCount - left.totalSeenCount ||
        right.averageDiggCount - left.averageDiggCount ||
        compareIsoDesc(left.lastSeenAt, right.lastSeenAt)
    )
    .slice(0, 20);

  const selectedTopicSet = new Set(topTopics.map((item) => item.topic));
  const topicDetails = allTopics
    .filter((bucket) => selectedTopicSet.has(bucket.topic))
    .map((bucket) => {
      const representativeWorks = bucket.works
        .map((work) => ({
          workId: String(work._id || ""),
          awemeId: work.awemeId || "",
          workUrl: work.workUrl || "",
          title: work.title || work.desc || work.awemeId || "",
          authorNickname: work.authorNickname || "",
          diggCount: toSafeNumber(work.diggCount),
          commentCount: toSafeNumber(work.commentCount),
          collectCount: toSafeNumber(work.collectCount),
          seenCount: toSafeNumber(work.seenCount),
          latestAnalysisScore: toSafeNumber(
            analysisByWorkId.get(String(work._id || ""))?.scores?.totalScore ||
              work.latestAnalysisScore
          ),
          lastSeenAt: work.lastSeenAt || null,
        }))
        .sort(
          (left, right) =>
            right.diggCount - left.diggCount ||
            right.seenCount - left.seenCount ||
            right.latestAnalysisScore - left.latestAnalysisScore ||
            compareIsoDesc(left.lastSeenAt, right.lastSeenAt)
        )
        .slice(0, 6);

      const representativeAuthors = [...bucket.authorStats.values()]
        .map((authorStats) => {
          const profile = authorProfileByKey.get(authorStats.authorKey);
          return {
            authorKey: authorStats.authorKey,
            authorNickname: profile?.authorNickname || authorStats.authorNickname || "",
            followerCount: profile?.followerCount || authorStats.followerCount,
            seenWorkCount: profile?.seenWorkCount || 0,
            seenExposureCount: profile?.seenExposureCount || 0,
            topicWorkCount: authorStats.workCount,
            topicSeenCount: authorStats.totalSeenCount,
            lastSeenAt: authorStats.lastSeenAt || profile?.lastSeenAt || null,
          };
        })
        .sort(
          (left, right) =>
            right.topicWorkCount - left.topicWorkCount ||
            right.topicSeenCount - left.topicSeenCount ||
            right.followerCount - left.followerCount
        )
        .slice(0, 6);

      const commentSamples = bucket.commentSamples
        .filter((item) => item.commentId)
        .sort(
          (left, right) =>
            right.diggCount - left.diggCount || right.replyCount - left.replyCount
        )
        .slice(0, 10);

      return {
        topic: bucket.topic,
        workCount: bucket.workIds.size,
        authorCount: bucket.authorKeys.size,
        averageDiggCount:
          bucket.workIds.size > 0 ? Math.round(bucket.totalDiggCount / bucket.workIds.size) : 0,
        averageCommentCount:
          bucket.workIds.size > 0 ? Math.round(bucket.totalCommentCount / bucket.workIds.size) : 0,
        averageCollectCount:
          bucket.workIds.size > 0 ? Math.round(bucket.totalCollectCount / bucket.workIds.size) : 0,
        totalSeenCount: bucket.totalSeenCount,
        lastSeenAt: bucket.lastSeenAt || null,
        representativeWorks,
        representativeAuthors,
        commentWordCloud: buildCountList(bucket.commentWordCounter, 30, 2),
        topCommentSamples: commentSamples,
      };
    })
    .sort((left, right) => right.workCount - left.workCount || right.totalSeenCount - left.totalSeenCount);

  return {
    topTopics,
    topicDetails,
  };
}

export async function getRecommendInsights(req, res, next) {
  try {
    const dateFrom = normalizeIsoDate(req.query.dateFrom);
    const dateTo = normalizeIsoDate(req.query.dateTo);

    const [allWorks, allAuthors, allAnalyses] = await Promise.all([
      RecommendWork.find(),
      RecommendAuthorProfile.find(),
      RecommendCommentAnalysis.find(),
    ]);

    const works = allWorks.filter((item) => {
      if (!dateFrom && !dateTo) {
        return true;
      }

      return isIsoInRange(item.lastSeenAt, dateFrom, dateTo);
    });

    const workIdSet = new Set(works.map((item) => String(item._id || "")).filter(Boolean));
    const authorKeySet = new Set(works.map((item) => String(item.authorKey || "")).filter(Boolean));
    const analyses = allAnalyses.filter((item) =>
      workIdSet.has(String(item.recommendWorkId || ""))
    );
    const authors = allAuthors.filter((item) => authorKeySet.has(String(item.authorKey || "")));

    const analysisByWorkId = new Map(
      analyses.map((analysis) => [String(analysis.recommendWorkId || ""), analysis])
    );
    const workById = new Map(works.map((work) => [String(work._id || ""), work]));

    const commentSampleCount = analyses.reduce(
      (sum, item) => sum + toSafeNumber(item.sampledCommentCount),
      0
    );

    const { topTopics, topicDetails } = buildTopicAggregates(works, analyses, authors);

    res.json({
      data: {
        range: {
          dateFrom: dateFrom || null,
          dateTo: dateTo || null,
        },
        overview: {
          workCount: works.length,
          authorCount: authors.length,
          analyzedWorkCount: analyses.length,
          topicCount: topTopics.length,
          commentSampleCount,
        },
        topLikedWorks: buildTopLikedWorks(works, analysisByWorkId, 18),
        topTopics,
        globalCommentWordCloud: buildGlobalCommentWordCloud(analyses, 80),
        topCommentSamples: buildGlobalTopCommentSamples(analyses, workById, 24),
        topicDetails,
        defaultTopic: topTopics[0]?.topic || "",
      },
    });
  } catch (error) {
    next(error);
  }
}
