import { CreatorProfile } from "../../models/CreatorProfile.js";
import { Work } from "../../models/Work.js";
import { WorkCommentAnalysis } from "../../models/WorkCommentAnalysis.js";

function escapeRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toFixedScore(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function createCreatorKey(work) {
  if (work?.userUrl) {
    return work.userUrl;
  }

  if (work?.userId) {
    return `uid:${work.userId}`;
  }

  return `nickname:${work?.authorName || "unknown"}`;
}

function buildCountList(entries, limit = 20) {
  return [...entries.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((left, right) => right.count - left.count || left.word.localeCompare(right.word))
    .slice(0, limit);
}

function buildCandidateLevel(totalScore) {
  if (totalScore >= 70) {
    return "high";
  }

  if (totalScore >= 45) {
    return "medium";
  }

  if (totalScore > 0) {
    return "low";
  }

  return "unknown";
}

function getAnalysisWeights(dictionary) {
  return {
    content: Number(dictionary?.weights?.content ?? 0.2),
    commentKeyword: Number(dictionary?.weights?.commentKeyword ?? 0.3),
    topComment: Number(dictionary?.weights?.topComment ?? 0.3),
    consistency: Number(dictionary?.weights?.consistency ?? 0.2),
  };
}

function buildConsistencyScore(analyses) {
  if (analyses.length === 0) {
    return 0;
  }

  const worksWithHits = analyses.filter(
    (item) =>
      Number(item?.keywordHits?.totalTargetCount || 0) +
        Number(item?.keywordHits?.totalStrongCount || 0) >
      0
  ).length;

  const repeatedKeywordMap = new Map();
  for (const analysis of analyses) {
    const uniqueKeywords = new Set(analysis?.matchedKeywords || []);
    for (const keyword of uniqueKeywords) {
      repeatedKeywordMap.set(keyword, (repeatedKeywordMap.get(keyword) || 0) + 1);
    }
  }

  const repeatedKeywordCount = [...repeatedKeywordMap.values()].filter(
    (count) => count >= 2
  ).length;

  const consistencyRatio = worksWithHits / analyses.length;
  const score = consistencyRatio * 75 + Math.min(25, repeatedKeywordCount * 6);
  return Math.min(100, toFixedScore(score));
}

async function findWorksForCreatorKey(creatorKey) {
  return Work.find().or([
    { userUrl: creatorKey },
    { userId: creatorKey.replace(/^uid:/, "") },
    { authorName: creatorKey.replace(/^nickname:/, "") },
  ]);
}

export async function rebuildCreatorProfile(creatorKey, dictionary) {
  const works = await findWorksForCreatorKey(creatorKey);

  if (works.length === 0) {
    return null;
  }

  const workIds = works.map((work) => work._id);
  const analyses = await WorkCommentAnalysis.find({ work: { $in: workIds } }).sort({
    generatedAt: -1,
  });
  const worksById = new Map(works.map((work) => [String(work._id), work]));

  if (analyses.length === 0) {
    return null;
  }

  const keywordSources = new Set();
  const keywordMap = new Map();
  const creatorComments = [];
  const sampleWorks = [];

  let contentScoreTotal = 0;
  let commentKeywordScoreTotal = 0;
  let topCommentScoreTotal = 0;
  let sampledCommentCount = 0;

  for (const analysis of analyses) {
    const work = worksById.get(String(analysis.work));
    if (!work) {
      continue;
    }

    if (work.keywordSource) {
      keywordSources.add(work.keywordSource);
    }

    sampledCommentCount += Number(analysis.sampledCommentCount || 0);
    contentScoreTotal += Number(analysis?.scores?.contentScore || 0);
    commentKeywordScoreTotal += Number(analysis?.scores?.commentKeywordScore || 0);
    topCommentScoreTotal += Number(analysis?.scores?.topCommentScore || 0);

    for (const wordItem of analysis.wordCloud || []) {
      keywordMap.set(
        wordItem.word,
        (keywordMap.get(wordItem.word) || 0) + Number(wordItem.count || 0)
      );
    }

    for (const comment of analysis.topComments || []) {
      creatorComments.push({
        workId: work._id,
        awemeId: work.awemeId,
        commentId: comment.commentId,
        text: comment.text,
        diggCount: Number(comment.diggCount || 0),
        authorName: comment.authorName || "",
      });
    }

    sampleWorks.push({
      workId: work._id,
      awemeId: work.awemeId,
      workUrl: work.workUrl,
      title: work.title || work.desc || work.awemeId,
      keywordSource: work.keywordSource || "",
      totalScore: Number(analysis?.scores?.totalScore || 0),
      analyzedAt: analysis.generatedAt || analysis.updatedAt || null,
    });
  }

  const analyzedWorkCount = analyses.length;
  const contentScore =
    analyzedWorkCount > 0 ? toFixedScore(contentScoreTotal / analyzedWorkCount) : 0;
  const commentKeywordScore =
    analyzedWorkCount > 0
      ? toFixedScore(commentKeywordScoreTotal / analyzedWorkCount)
      : 0;
  const topCommentScore =
    analyzedWorkCount > 0 ? toFixedScore(topCommentScoreTotal / analyzedWorkCount) : 0;
  const consistencyScore = buildConsistencyScore(analyses);
  const weights = getAnalysisWeights(dictionary);
  const totalScore = toFixedScore(
    contentScore * weights.content +
      commentKeywordScore * weights.commentKeyword +
      topCommentScore * weights.topComment +
      consistencyScore * weights.consistency
  );

  const primaryWork = sampleWorks[0]
    ? worksById.get(String(sampleWorks[0].workId))
    : works[0];
  const previousProfile = await CreatorProfile.findOne({ creatorKey });

  return CreatorProfile.findOneAndUpdate(
    { creatorKey },
    {
      $set: {
        userUrl: primaryWork?.userUrl || "",
        userId: primaryWork?.userId || "",
        nickname: primaryWork?.authorName || "",
        authorAvatar: primaryWork?.authorAvatar || "",
        userDesc: primaryWork?.userDesc || "",
        keywordSources: [...keywordSources].sort(),
        sampleWorks: sampleWorks
          .sort((left, right) => right.totalScore - left.totalScore)
          .slice(0, 8),
        topKeywords: buildCountList(keywordMap, 30),
        topComments: creatorComments
          .sort((left, right) => right.diggCount - left.diggCount)
          .slice(0, 10),
        analyzedWorkCount,
        sampledCommentCount,
        contentScore,
        commentKeywordScore,
        topCommentScore,
        consistencyScore,
        totalScore,
        candidateLevel: buildCandidateLevel(totalScore),
        reviewStatus: previousProfile?.reviewStatus || "new",
        reviewNote: previousProfile?.reviewNote || "",
        lastAnalyzedAt: new Date(),
      },
      $setOnInsert: {
        creatorKey,
      },
    },
    {
      new: true,
      runValidators: true,
      upsert: true,
    }
  );
}

export async function rebuildCreatorProfileForWork(work, dictionary) {
  return rebuildCreatorProfile(createCreatorKey(work), dictionary);
}

export async function rebuildCreatorProfilesFromAnalyses(dictionary, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 50, 200));
  const workFilter = {};

  if (options.keyword) {
    const keywordRegex = new RegExp(escapeRegex(options.keyword), "i");
    workFilter.$or = [
      { keywordSource: keywordRegex },
      { title: keywordRegex },
      { desc: keywordRegex },
      { authorName: keywordRegex },
    ];
  }

  const works = await Work.find(workFilter).sort({ updatedAt: -1 }).limit(limit);
  const creatorKeys = [...new Set(works.map((work) => createCreatorKey(work)))];
  const results = [];

  for (const creatorKey of creatorKeys) {
    const profile = await rebuildCreatorProfile(creatorKey, dictionary);
    if (profile) {
      results.push(profile);
    }
  }

  return results.sort((left, right) => right.totalScore - left.totalScore);
}

export function getCreatorKeyFromWork(work) {
  return createCreatorKey(work);
}
