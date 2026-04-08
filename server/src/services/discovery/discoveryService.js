import { Keyword } from "../../models/Keyword.js";
import { OperationLog } from "../../models/OperationLog.js";
import { Work } from "../../models/Work.js";
import {
  KEYWORD_SEARCH_STRATEGIES,
  searchGeneralWorkBatch,
  searchSomeGeneralWork,
} from "../douyin/searchService.js";
import {
  buildWorkUpsertOperation,
  mapSearchItemToWorkDocument,
} from "../douyin/workMapper.js";

function createHttpError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
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

function buildDiscoveryOptions(keyword, options = {}) {
  const requireNum = Number(options.requireNum ?? keyword.dailyLimit ?? 20);
  return {
    cookieString: String(options.cookieString || ""),
    query: keyword.keyword,
    requireNum,
    pageSize: Number(options.pageSize ?? 25),
    offset: Number(options.offset ?? 0),
    sortType: options.sortType ?? "0",
    publishTime: options.publishTime ?? "0",
    filterDuration: options.filterDuration ?? "",
    searchRange: options.searchRange ?? "0",
    contentType: options.contentType ?? "0",
    searchStrategy: options.searchStrategy ?? KEYWORD_SEARCH_STRATEGIES.AUTO,
  };
}

async function loadKeyword(keywordId) {
  const keyword = await Keyword.findById(keywordId);
  if (!keyword) {
    throw createHttpError("Keyword not found.", 404);
  }

  return keyword;
}

async function persistDiscoveredWorks({
  keyword,
  rawItems,
  requestedCount,
  taskType,
  meta = {},
}) {
  const workDocuments = rawItems
    .map((item) => mapSearchItemToWorkDocument(item, keyword.keyword))
    .filter(Boolean);

  if (workDocuments.length === 0) {
    await writeOperationLog(
      taskType,
      "warning",
      `Keyword "${keyword.keyword}" returned no valid works.`,
      {
        keywordId: keyword.id,
        requestedCount,
        fetchedCount: rawItems.length,
        ...meta,
      }
    );

    return {
      keyword,
      requestedCount,
      fetchedCount: rawItems.length,
      normalizedCount: 0,
      insertedCount: 0,
      matchedCount: 0,
      modifiedCount: 0,
      works: [],
      ...meta,
    };
  }

  const bulkResult = await Work.bulkWrite(
    workDocuments.map(buildWorkUpsertOperation),
    { ordered: false }
  );
  const awemeIds = workDocuments.map((item) => item.awemeId);
  const works = await Work.find({ awemeId: { $in: awemeIds } }).sort({
    updatedAt: -1,
  });

  const result = {
    keyword,
    requestedCount,
    fetchedCount: rawItems.length,
    normalizedCount: workDocuments.length,
    insertedCount: bulkResult.upsertedCount ?? 0,
    matchedCount: bulkResult.matchedCount ?? 0,
    modifiedCount: bulkResult.modifiedCount ?? 0,
    works,
    ...meta,
  };

  await writeOperationLog(
    taskType,
    "success",
    `Keyword "${keyword.keyword}" discovered ${workDocuments.length} works.`,
    {
      keywordId: keyword.id,
      requestedCount,
      fetchedCount: rawItems.length,
      normalizedCount: workDocuments.length,
      insertedCount: result.insertedCount,
      modifiedCount: result.modifiedCount,
      ...meta,
    }
  );

  return result;
}

export async function discoverWorksByKeywordId(keywordId, options = {}) {
  const keyword = await loadKeyword(keywordId);
  const discoveryOptions = buildDiscoveryOptions(keyword, options);

  try {
    const rawItems = await searchSomeGeneralWork(discoveryOptions);
    return await persistDiscoveredWorks({
      keyword,
      rawItems,
      requestedCount: discoveryOptions.requireNum,
      taskType: "discovery.search",
      meta: {
        searchStrategy: discoveryOptions.searchStrategy,
      },
    });
  } catch (error) {
    await writeOperationLog(
      "discovery.search",
      "error",
      `Keyword "${keyword.keyword}" discovery failed: ${error.message}`,
      {
        keywordId,
        requestedCount: discoveryOptions.requireNum,
      }
    );
    throw error;
  }
}

export async function discoverWorksByKeywordPage(keywordId, options = {}) {
  const keyword = await loadKeyword(keywordId);
  const discoveryOptions = buildDiscoveryOptions(keyword, options);

  try {
    const batch = await searchGeneralWorkBatch({
      cookieString: discoveryOptions.cookieString,
      query: discoveryOptions.query,
      offset: discoveryOptions.offset,
      count: discoveryOptions.pageSize,
      sortType: discoveryOptions.sortType,
      publishTime: discoveryOptions.publishTime,
      filterDuration: discoveryOptions.filterDuration,
      searchRange: discoveryOptions.searchRange,
      contentType: discoveryOptions.contentType,
      searchStrategy: discoveryOptions.searchStrategy,
    });

    return await persistDiscoveredWorks({
      keyword,
      rawItems: batch.items,
      requestedCount: discoveryOptions.pageSize,
      taskType: "discovery.search.page",
      meta: {
        offset: discoveryOptions.offset,
        nextOffset: batch.nextOffset,
        hasMore: batch.hasMore,
        searchStrategy: discoveryOptions.searchStrategy,
      },
    });
  } catch (error) {
    await writeOperationLog(
      "discovery.search.page",
      "error",
      `Keyword "${keyword.keyword}" page discovery failed: ${error.message}`,
      {
        keywordId,
        offset: discoveryOptions.offset,
        requestedCount: discoveryOptions.pageSize,
      }
    );
    throw error;
  }
}
