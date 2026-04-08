import { OperationLog } from "../../models/OperationLog.js";
import { Work } from "../../models/Work.js";
import { WorkComment } from "../../models/WorkComment.js";
import { WorkCommentAnalysis } from "../../models/WorkCommentAnalysis.js";
import { getSharedDouyinCookieString } from "../douyin/auth.js";
import { fetchWorkComments } from "../douyin/commentService.js";
import {
  buildCanonicalVariantMap,
  getAnalysisDictionary,
} from "./dictionaryService.js";
import {
  getCreatorKeyFromWork,
  rebuildCreatorProfileForWork,
} from "./creatorScoringService.js";

function escapeRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createHttpError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function roundScore(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, roundScore(value)));
}

async function writeOperationLog(taskType, status, message, payload = null) {
  try {
    await OperationLog.create({
      taskType,
      status,
      message,
      payload,
    });
  } catch (error) {
    console.error("[operation-log] failed to write log", error);
  }
}

function cleanCommentText(value = "") {
  return String(value || "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/#[^#\s]+/g, " ")
    .replace(/@[\S]+/g, " ")
    .replace(/\[[^\]]+]/g, " ")
    .replace(/[^\p{Script=Han}A-Za-z0-9]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countOccurrences(text, searchValue) {
  if (!text || !searchValue) {
    return 0;
  }

  let count = 0;
  let startIndex = 0;

  while (true) {
    const matchedIndex = text.indexOf(searchValue, startIndex);
    if (matchedIndex === -1) {
      return count;
    }

    count += 1;
    startIndex = matchedIndex + searchValue.length;
  }
}

function buildDictionaryHitIndex(dictionary) {
  const canonicalMap = buildCanonicalVariantMap(dictionary);
  const targetSet = new Set(dictionary?.targetWords || []);
  const strongSet = new Set(dictionary?.strongSignalWords || []);
  const phrases = [...canonicalMap.keys()].sort((left, right) => right.length - left.length);

  return {
    canonicalMap,
    targetSet,
    strongSet,
    phrases,
  };
}

function tokenizeForWordCloud(cleanText, stopWordsSet, canonicalMap) {
  const chunks = cleanText.split(/\s+/).filter(Boolean);
  const tokens = [];

  for (const chunk of chunks) {
    if (/^[A-Za-z0-9]+$/.test(chunk)) {
      const normalized = chunk.toLowerCase();
      if (normalized.length >= 3 && !stopWordsSet.has(normalized)) {
        tokens.push(canonicalMap.get(normalized) || normalized);
      }
      continue;
    }

    if (!/^[\p{Script=Han}]+$/u.test(chunk)) {
      continue;
    }

    if (chunk.length >= 2 && chunk.length <= 6 && !stopWordsSet.has(chunk)) {
      tokens.push(canonicalMap.get(chunk) || chunk);
    }

    if (chunk.length >= 4) {
      for (const size of [2, 3]) {
        if (chunk.length < size) {
          continue;
        }

        for (let index = 0; index <= chunk.length - size; index += 1) {
          const segment = chunk.slice(index, index + size);
          if (!stopWordsSet.has(segment)) {
            tokens.push(canonicalMap.get(segment) || segment);
          }
        }
      }
    }
  }

  return tokens;
}

function incrementCounter(counterMap, word, count = 1) {
  if (!word) {
    return;
  }

  counterMap.set(word, (counterMap.get(word) || 0) + count);
}

function buildCountList(counterMap, limit = 20, minimumCount = 1) {
  return [...counterMap.entries()]
    .filter(([, count]) => count >= minimumCount)
    .map(([word, count]) => ({ word, count }))
    .sort((left, right) => right.count - left.count || left.word.localeCompare(right.word))
    .slice(0, limit);
}

function analyzeContentSignals(work, dictionaryIndex) {
  const text = cleanCommentText(
    [work.title, work.desc, work.userDesc, ...(work.topics || [])].join(" ")
  );

  let targetCount = 0;
  let strongCount = 0;
  const matchedKeywords = new Set();

  for (const phrase of dictionaryIndex.phrases) {
    const count = countOccurrences(text, phrase);
    if (!count) {
      continue;
    }

    const canonicalWord = dictionaryIndex.canonicalMap.get(phrase) || phrase;
    matchedKeywords.add(canonicalWord);

    if (dictionaryIndex.targetSet.has(canonicalWord)) {
      targetCount += count;
    } else if (dictionaryIndex.strongSet.has(canonicalWord)) {
      strongCount += count;
    }
  }

  return clampScore(targetCount * 12 + strongCount * 15 + matchedKeywords.size * 4);
}

function buildCommentAnalysisPayload(work, comments, dictionary) {
  const stopWordsSet = new Set((dictionary?.stopWords || []).map((word) => word.toLowerCase()));
  const dictionaryIndex = buildDictionaryHitIndex(dictionary);
  const targetCounter = new Map();
  const strongCounter = new Map();
  const wordCloudCounter = new Map();
  const matchedKeywords = new Set();
  const commentHitDetails = [];
  let targetHitComments = 0;
  let strongHitComments = 0;
  let totalTargetCount = 0;
  let totalStrongCount = 0;

  const normalizedComments = comments.map((comment) => ({
    ...comment,
    cleanText: cleanCommentText(comment.text),
  }));

  for (const comment of normalizedComments) {
    let commentTargetCount = 0;
    let commentStrongCount = 0;
    const matchedInComment = new Set();

    for (const phrase of dictionaryIndex.phrases) {
      const hitCount = countOccurrences(comment.cleanText, phrase);
      if (!hitCount) {
        continue;
      }

      const canonicalWord = dictionaryIndex.canonicalMap.get(phrase) || phrase;
      matchedInComment.add(canonicalWord);
      matchedKeywords.add(canonicalWord);

      if (dictionaryIndex.targetSet.has(canonicalWord)) {
        incrementCounter(targetCounter, canonicalWord, hitCount);
        commentTargetCount += hitCount;
        totalTargetCount += hitCount;
      } else if (dictionaryIndex.strongSet.has(canonicalWord)) {
        incrementCounter(strongCounter, canonicalWord, hitCount);
        commentStrongCount += hitCount;
        totalStrongCount += hitCount;
      }
    }

    if (commentTargetCount > 0) {
      targetHitComments += 1;
    }

    if (commentStrongCount > 0) {
      strongHitComments += 1;
    }

    const tokens = tokenizeForWordCloud(
      comment.cleanText,
      stopWordsSet,
      dictionaryIndex.canonicalMap
    );
    for (const token of tokens) {
      if (token.length >= 2) {
        incrementCounter(wordCloudCounter, token);
      }
    }

    commentHitDetails.push({
      ...comment,
      matchedKeywords: [...matchedInComment],
      totalHitCount: commentTargetCount + commentStrongCount,
    });
  }

  const topComments = [...commentHitDetails]
    .sort((left, right) => right.diggCount - left.diggCount)
    .slice(0, 10);
  const top10KeywordHitCount = topComments.filter(
    (comment) => comment.totalHitCount > 0
  ).length;
  const top10KeywordHitRate =
    topComments.length > 0 ? roundScore(top10KeywordHitCount / topComments.length) : 0;
  const sampledCommentCount = normalizedComments.length;
  const contentScore = analyzeContentSignals(work, dictionaryIndex);
  const commentKeywordScore = clampScore(
    sampledCommentCount > 0
      ? ((targetHitComments + strongHitComments * 1.4) / sampledCommentCount) * 70 +
          Math.min(25, totalTargetCount * 2 + totalStrongCount * 3)
      : 0
  );
  const topCommentLikeTotal = topComments.reduce(
    (sum, comment) => sum + Number(comment.diggCount || 0),
    0
  );
  const topCommentHitLikeTotal = topComments
    .filter((comment) => comment.totalHitCount > 0)
    .reduce((sum, comment) => sum + Number(comment.diggCount || 0), 0);
  const topCommentScore = clampScore(
    topComments.length > 0
      ? top10KeywordHitRate * 60 +
          (topCommentLikeTotal > 0
            ? (topCommentHitLikeTotal / topCommentLikeTotal) * 40
            : 0)
      : 0
  );
  const totalScore = clampScore(
    contentScore * Number(dictionary?.weights?.content ?? 0.2) +
      commentKeywordScore * Number(dictionary?.weights?.commentKeyword ?? 0.3) +
      topCommentScore * Number(dictionary?.weights?.topComment ?? 0.3)
  );

  return {
    creatorKey: getCreatorKeyFromWork(work),
    sampledCommentCount,
    topComments: topComments.map((comment) => ({
      commentId: comment.commentId,
      text: comment.text,
      diggCount: comment.diggCount,
      replyCount: comment.replyCount,
      authorName: comment.author.nickname || "",
    })),
    wordCloud: buildCountList(wordCloudCounter, 30, 2),
    keywordHits: {
      target: buildCountList(targetCounter, 20),
      strong: buildCountList(strongCounter, 20),
      totalTargetCount,
      totalStrongCount,
      top10KeywordHitCount,
      top10KeywordHitRate,
    },
    matchedKeywords: [...matchedKeywords].sort(),
    scores: {
      contentScore,
      commentKeywordScore,
      topCommentScore,
      totalScore,
    },
    commentDocuments: commentHitDetails,
  };
}

function buildCommentUpsert(work, comment, isTopComment) {
  return {
    updateOne: {
      filter: { commentId: comment.commentId },
      update: {
        $set: {
          work: work._id,
          awemeId: work.awemeId,
          text: comment.text,
          cleanText: comment.cleanText,
          diggCount: comment.diggCount,
          replyCount: comment.replyCount,
          isTopComment,
          commentCreatedAt: comment.commentCreatedAt,
          author: comment.author,
          sourceKeyword: work.keywordSource || "",
          rawJson: comment.rawJson || {},
        },
      },
      upsert: true,
    },
  };
}

async function persistComments(work, analysisPayload) {
  const topCommentIds = new Set(
    analysisPayload.topComments.map((comment) => comment.commentId)
  );

  if (analysisPayload.commentDocuments.length === 0) {
    return;
  }

  await WorkComment.bulkWrite(
    analysisPayload.commentDocuments.map((comment) =>
      buildCommentUpsert(work, comment, topCommentIds.has(comment.commentId))
    ),
    { ordered: false }
  );
}

async function loadWork(workId) {
  const work = await Work.findById(workId);
  if (!work) {
    throw createHttpError("Work not found.", 404);
  }

  return work;
}

export async function analyzeWorkComments(workId, options = {}) {
  const work = await loadWork(workId);
  const commentLimit = Math.max(5, Math.min(Number(options.commentLimit) || 30, 100));
  const cookieString = String(options.cookieString || "").trim();
  const dictionary = await getAnalysisDictionary();

  try {
    const comments = await fetchWorkComments({
      cookieString: cookieString || getSharedDouyinCookieString(),
      awemeId: work.awemeId,
      workUrl: work.workUrl,
      limit: commentLimit,
    });
    const analysisPayload = buildCommentAnalysisPayload(work, comments, dictionary);

    await persistComments(work, analysisPayload);

    const analysis = await WorkCommentAnalysis.findOneAndUpdate(
      { work: work._id },
      {
        $set: {
          work: work._id,
          awemeId: work.awemeId,
          creatorKey: analysisPayload.creatorKey,
          sampledCommentCount: analysisPayload.sampledCommentCount,
          topComments: analysisPayload.topComments,
          wordCloud: analysisPayload.wordCloud,
          keywordHits: analysisPayload.keywordHits,
          matchedKeywords: analysisPayload.matchedKeywords,
          scores: analysisPayload.scores,
          generatedAt: new Date(),
        },
      },
      {
        new: true,
        runValidators: true,
        upsert: true,
      }
    );

    const creatorProfile = await rebuildCreatorProfileForWork(work, dictionary);

    await writeOperationLog(
      "analysis.comments",
      "success",
      `Analyzed comments for work ${work.awemeId}.`,
      {
        workId,
        awemeId: work.awemeId,
        sampledCommentCount: analysis.sampledCommentCount,
        totalScore: analysis?.scores?.totalScore || 0,
      }
    );

    return {
      work,
      analysis,
      creatorProfile,
    };
  } catch (error) {
    await writeOperationLog(
      "analysis.comments",
      "error",
      `Comment analysis failed for work ${work.awemeId}: ${error.message}`,
      {
        workId,
        awemeId: work.awemeId,
      }
    );
    throw error;
  }
}

export async function getWorkCommentAnalysis(workId) {
  const work = await loadWork(workId);
  const analysis = await WorkCommentAnalysis.findOne({ work: work._id });
  const comments = await WorkComment.find({ work: work._id })
    .sort({ diggCount: -1, createdAt: -1 })
    .limit(20);

  return {
    work,
    analysis,
    comments,
  };
}

export async function analyzeLatestWorks(options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 10, 50));
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
  const results = [];

  for (const work of works) {
    try {
      const result = await analyzeWorkComments(String(work._id), {
        commentLimit: options.commentLimit,
      });
      results.push({
        workId: String(work._id),
        awemeId: work.awemeId,
        success: true,
        totalScore: result.analysis?.scores?.totalScore || 0,
      });
    } catch (error) {
      results.push({
        workId: String(work._id),
        awemeId: work.awemeId,
        success: false,
        error: error.message,
      });
    }
  }

  return results;
}
