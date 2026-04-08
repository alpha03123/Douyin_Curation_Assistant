import { rm } from "node:fs/promises";
import { z } from "zod";
import { Work } from "../models/Work.js";
import { ActionTask } from "../models/ActionTask.js";
import { ActionExecutionLog } from "../models/ActionExecutionLog.js";
import { DownloadTask } from "../models/DownloadTask.js";
import { DownloadedAsset } from "../models/DownloadedAsset.js";
import { WorkComment } from "../models/WorkComment.js";
import { WorkCommentAnalysis } from "../models/WorkCommentAnalysis.js";

function escapeRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SORT_FIELD_MAP = {
  updatedAt: "updatedAt",
  diggCount: "diggCount",
  commentCount: "commentCount",
  collectCount: "collectCount",
  shareCount: "shareCount",
};

const batchDeleteSchema = z.object({
  workIds: z.array(z.string().min(1)).min(1),
  removeDownloadedFiles: z.boolean().optional(),
});

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

export async function listWorks(req, res, next) {
  try {
    const {
      keyword,
      status,
      sourceType,
      dateFrom,
      dateTo,
      publishFrom,
      publishTo,
      sortBy = "updatedAt",
      sortOrder = "desc",
    } = req.query;
    const limit = Math.min(Number(req.query.limit || 100), 200);
    const includeAnalysis =
      req.query.includeAnalysis === "1" || req.query.includeAnalysis === "true";
    const filter = {};

    if (keyword) {
      const keywordRegex = new RegExp(escapeRegex(keyword), "i");
      filter.$or = [
        { keywordSource: keywordRegex },
        { title: keywordRegex },
        { desc: keywordRegex },
        { authorName: keywordRegex },
      ];
    }

    if (status) {
      filter.status = status;
    }

    if (sourceType) {
      filter.discoverySource = String(sourceType);
    }

    const normalizedDateFrom = normalizeIsoDate(dateFrom);
    const normalizedDateTo = normalizeIsoDate(dateTo);
    if (normalizedDateFrom || normalizedDateTo) {
      filter.updatedAt = {};
      if (normalizedDateFrom) {
        filter.updatedAt.$gte = normalizedDateFrom;
      }
      if (normalizedDateTo) {
        filter.updatedAt.$lte = normalizedDateTo;
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

    const normalizedSortField = SORT_FIELD_MAP[sortBy] || "updatedAt";
    const normalizedSortOrder = sortOrder === "asc" ? 1 : -1;
    const sortConfig = {
      [normalizedSortField]: normalizedSortOrder,
      updatedAt: -1,
    };

    const items = await Work.find(filter).sort(sortConfig).limit(limit);

    if (!includeAnalysis || items.length === 0) {
      res.json({ data: items });
      return;
    }

    const analyses = await WorkCommentAnalysis.find({
      work: { $in: items.map((item) => item._id) },
    });
    const analysisByWorkId = new Map(
      analyses.map((analysis) => [String(analysis.work), analysis])
    );

    const responseItems = items.map((item) => {
      const plainItem = item.toObject();
      const analysis = analysisByWorkId.get(String(item._id));

      plainItem.analysisSummary = analysis
        ? {
            sampledCommentCount: analysis.sampledCommentCount,
            generatedAt: analysis.generatedAt,
            totalScore: analysis?.scores?.totalScore || 0,
            top10KeywordHitRate: analysis?.keywordHits?.top10KeywordHitRate || 0,
          }
        : null;

      return plainItem;
    });

    res.json({ data: responseItems });
  } catch (error) {
    next(error);
  }
}

async function removeDocuments(items = [], model) {
  let count = 0;

  for (const item of items) {
    const deleted = await model.findByIdAndDelete(item._id);
    if (deleted) {
      count += 1;
    }
  }

  return count;
}

async function removeDownloadedFiles(assets = []) {
  let removedFiles = 0;

  for (const asset of assets) {
    if (!asset.localPath) {
      continue;
    }

    try {
      await rm(asset.localPath, { force: true });
      removedFiles += 1;
    } catch {
      continue;
    }
  }

  return removedFiles;
}

export async function batchDeleteWorks(req, res, next) {
  try {
    const payload = batchDeleteSchema.parse(req.body || {});
    const workIds = [...new Set(payload.workIds.map((item) => String(item)))];
    const works = await Work.find({ _id: { $in: workIds } });

    if (works.length === 0) {
      const error = new Error("No works matched the selected IDs.");
      error.statusCode = 404;
      throw error;
    }

    const normalizedWorkIds = works.map((item) => String(item._id));
    const [comments, analyses, actionTasks, downloadTasks] = await Promise.all([
      WorkComment.find({ work: { $in: normalizedWorkIds } }),
      WorkCommentAnalysis.find({ work: { $in: normalizedWorkIds } }),
      ActionTask.find({ workId: { $in: normalizedWorkIds } }),
      DownloadTask.find({
        $or: [
          { workId: { $in: normalizedWorkIds } },
          {
            sourceType: "work",
            sourceId: { $in: normalizedWorkIds },
          },
        ],
      }),
    ]);

    const actionTaskIds = actionTasks.map((item) => String(item._id));
    const downloadTaskIds = downloadTasks.map((item) => String(item._id));
    const [executionLogs, downloadedAssets] = await Promise.all([
      ActionExecutionLog.find({
        $or: [
          { workId: { $in: normalizedWorkIds } },
          { taskId: { $in: actionTaskIds } },
        ],
      }),
      DownloadedAsset.find({ taskId: { $in: downloadTaskIds } }),
    ]);

    let removedFileCount = 0;
    if (payload.removeDownloadedFiles) {
      removedFileCount = await removeDownloadedFiles(downloadedAssets);
    }

    const [
      deletedExecutionLogs,
      deletedActionTasks,
      deletedComments,
      deletedAnalyses,
      deletedDownloadedAssets,
      deletedDownloadTasks,
      deletedWorks,
    ] = await Promise.all([
      removeDocuments(executionLogs, ActionExecutionLog),
      removeDocuments(actionTasks, ActionTask),
      removeDocuments(comments, WorkComment),
      removeDocuments(analyses, WorkCommentAnalysis),
      removeDocuments(downloadedAssets, DownloadedAsset),
      removeDocuments(downloadTasks, DownloadTask),
      removeDocuments(works, Work),
    ]);

    res.json({
      data: {
        requested: workIds.length,
        matched: works.length,
        deletedWorks,
        deletedComments,
        deletedAnalyses,
        deletedActionTasks,
        deletedExecutionLogs,
        deletedDownloadTasks,
        deletedDownloadedAssets,
        removedFileCount,
      },
    });
  } catch (error) {
    next(error);
  }
}
