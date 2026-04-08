import { AnalysisDictionary } from "../../models/AnalysisDictionary.js";
import { WorkCommentAnalysis } from "../../models/WorkCommentAnalysis.js";

export const DEFAULT_ANALYSIS_DICTIONARY = {
  targetWords: ["美女", "姐姐", "小姐姐", "女神", "好看", "气质"],
  strongSignalWords: ["颜值", "身材", "腿", "御姐", "甜妹", "仙女"],
  stopWords: [
    "哈哈",
    "哈哈哈",
    "来了",
    "支持",
    "打卡",
    "路过",
    "可以",
    "真的",
    "这个",
    "那个",
  ],
  synonymMap: {
    姐姐: ["小姐姐"],
  },
  weights: {
    content: 0.2,
    commentKeyword: 0.3,
    topComment: 0.3,
    consistency: 0.2,
  },
};

function uniqueTrimmedWords(values = []) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    ),
  ];
}

function normalizeSynonymMap(synonymMap = {}) {
  if (!synonymMap || typeof synonymMap !== "object" || Array.isArray(synonymMap)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(synonymMap)
      .map(([canonicalWord, variants]) => [
        String(canonicalWord || "").trim(),
        uniqueTrimmedWords(variants),
      ])
      .filter(([canonicalWord, variants]) => canonicalWord && variants.length > 0)
  );
}

function normalizeWeights(weights = {}) {
  const nextWeights = {
    ...DEFAULT_ANALYSIS_DICTIONARY.weights,
  };

  if (weights && typeof weights === "object") {
    for (const key of Object.keys(nextWeights)) {
      const value = Number(weights[key]);
      if (Number.isFinite(value) && value >= 0) {
        nextWeights[key] = value;
      }
    }
  }

  return nextWeights;
}

function normalizeDictionaryDocument(dictionary) {
  return {
    targetWords: uniqueTrimmedWords(dictionary?.targetWords),
    strongSignalWords: uniqueTrimmedWords(dictionary?.strongSignalWords),
    stopWords: uniqueTrimmedWords(dictionary?.stopWords),
    synonymMap: normalizeSynonymMap(dictionary?.synonymMap),
    weights: normalizeWeights(dictionary?.weights),
  };
}

function normalizeWord(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export async function getAnalysisDictionary() {
  let dictionary = await AnalysisDictionary.findOne({ name: "default" });

  if (!dictionary) {
    dictionary = await AnalysisDictionary.create({
      name: "default",
      ...DEFAULT_ANALYSIS_DICTIONARY,
    });
  }

  return normalizeDictionaryDocument(dictionary);
}

export async function updateAnalysisDictionary(payload = {}) {
  const currentDictionary = await getAnalysisDictionary();
  const nextDictionary = normalizeDictionaryDocument({
    ...currentDictionary,
    ...payload,
    synonymMap: {
      ...currentDictionary.synonymMap,
      ...(payload?.synonymMap || {}),
    },
    weights: {
      ...currentDictionary.weights,
      ...(payload?.weights || {}),
    },
  });

  const dictionary = await AnalysisDictionary.findOneAndUpdate(
    { name: "default" },
    {
      $set: {
        ...nextDictionary,
      },
      $setOnInsert: {
        name: "default",
      },
    },
    {
      new: true,
      runValidators: true,
      upsert: true,
    }
  );

  return normalizeDictionaryDocument(dictionary);
}

export async function getDictionaryWordCloudSuggestions(options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 80, 300));
  const minCount = Math.max(1, Number(options.minCount) || 2);
  const keyword = String(options.keyword || "").trim().toLowerCase();
  const dictionary = await getAnalysisDictionary();
  const analyses = await WorkCommentAnalysis.find({}).sort({
    generatedAt: -1,
    updatedAt: -1,
  });

  const bucket = new Map();
  const targetSet = new Set(dictionary.targetWords.map((item) => normalizeWord(item)));
  const strongSet = new Set(
    dictionary.strongSignalWords.map((item) => normalizeWord(item))
  );
  const stopSet = new Set(dictionary.stopWords.map((item) => normalizeWord(item)));

  for (const analysis of analyses) {
    for (const wordItem of analysis.wordCloud || []) {
      const word = String(wordItem.word || "").trim();
      const normalizedWord = normalizeWord(word);
      if (!word || !normalizedWord) {
        continue;
      }

      const current = bucket.get(normalizedWord) || {
        word,
        count: 0,
        workCount: 0,
      };
      current.count += Number(wordItem.count || 0);
      current.workCount += 1;
      bucket.set(normalizedWord, current);
    }
  }

  return [...bucket.entries()]
    .map(([normalizedWord, item]) => ({
      word: item.word,
      count: item.count,
      workCount: item.workCount,
      inTargetWords: targetSet.has(normalizedWord),
      inStrongSignalWords: strongSet.has(normalizedWord),
      inStopWords: stopSet.has(normalizedWord),
    }))
    .filter((item) => item.count >= minCount)
    .filter((item) => !keyword || item.word.toLowerCase().includes(keyword))
    .sort((left, right) => right.count - left.count || right.workCount - left.workCount)
    .slice(0, limit);
}

export function buildCanonicalVariantMap(dictionary) {
  const canonicalMap = new Map();
  const targetWords = dictionary?.targetWords || [];
  const strongSignalWords = dictionary?.strongSignalWords || [];
  const synonymMap = dictionary?.synonymMap || {};

  for (const word of [...targetWords, ...strongSignalWords]) {
    canonicalMap.set(word, word);
  }

  for (const [canonicalWord, variants] of Object.entries(synonymMap)) {
    canonicalMap.set(canonicalWord, canonicalWord);

    for (const variant of variants) {
      canonicalMap.set(variant, canonicalWord);
    }
  }

  return canonicalMap;
}
