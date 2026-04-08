import { RecommendAuthorProfile } from "../../models/RecommendAuthorProfile.js";
import { RecommendAuthorSnapshot } from "../../models/RecommendAuthorSnapshot.js";
import { RecommendComment } from "../../models/RecommendComment.js";
import { RecommendCommentAnalysis } from "../../models/RecommendCommentAnalysis.js";
import { RecommendExposure } from "../../models/RecommendExposure.js";
import { RecommendRun } from "../../models/RecommendRun.js";
import { RecommendWork } from "../../models/RecommendWork.js";
import { rebuildRecommendAuthorProfile } from "./recommendAuthorService.js";

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

export async function cleanupRecommendAuthors(authorKeys = []) {
  const safeAuthorKeys = [...new Set(authorKeys.map((item) => String(item || "").trim()).filter(Boolean))];
  let deletedAuthors = 0;
  const rebuiltAuthorIds = [];

  for (const authorKey of safeAuthorKeys) {
    const works = await RecommendWork.find({ authorKey });
    if (works.length === 0) {
      const snapshots = await RecommendAuthorSnapshot.find({ authorKey });
      await removeDocuments(snapshots, RecommendAuthorSnapshot);
      const deleted = await RecommendAuthorProfile.findOne({ authorKey });
      if (deleted) {
        await RecommendAuthorProfile.findByIdAndDelete(deleted._id);
        deletedAuthors += 1;
      }
      continue;
    }

    const rebuilt = await rebuildRecommendAuthorProfile(authorKey);
    if (rebuilt?._id) {
      rebuiltAuthorIds.push(String(rebuilt._id));
    }
  }

  return {
    deletedAuthors,
    rebuiltAuthorIds,
  };
}

export async function deleteRecommendRunById(runId) {
  const run = await RecommendRun.findById(runId);
  if (!run) {
    const error = new Error("Recommend run not found.");
    error.statusCode = 404;
    throw error;
  }

  const exposures = await RecommendExposure.find({ runId: String(runId) });
  const snapshots = await RecommendAuthorSnapshot.find({ runId: String(runId) });

  const [deletedExposures, deletedSnapshots] = await Promise.all([
    removeDocuments(exposures, RecommendExposure),
    removeDocuments(snapshots, RecommendAuthorSnapshot),
  ]);
  await RecommendRun.findByIdAndDelete(run._id);

  return {
    deleted: true,
    runId: String(runId),
    deletedExposures,
    deletedSnapshots,
  };
}

export async function batchDeleteRecommendWorks(workIds = []) {
  const safeWorkIds = [...new Set((Array.isArray(workIds) ? workIds : []).map((item) => String(item || "").trim()).filter(Boolean))];
  const works = await RecommendWork.find({ _id: { $in: safeWorkIds } });

  if (works.length === 0) {
    const error = new Error("No recommend works matched the selected IDs.");
    error.statusCode = 404;
    throw error;
  }

  const normalizedWorkIds = works.map((item) => String(item._id));
  const authorKeys = works.map((item) => String(item.authorKey || "")).filter(Boolean);

  const [comments, analyses, exposures, snapshots] = await Promise.all([
    RecommendComment.find({ recommendWorkId: { $in: normalizedWorkIds } }),
    RecommendCommentAnalysis.find({ recommendWorkId: { $in: normalizedWorkIds } }),
    RecommendExposure.find({ recommendWorkId: { $in: normalizedWorkIds } }),
    RecommendAuthorSnapshot.find({ recommendWorkId: { $in: normalizedWorkIds } }),
  ]);

  const [
    deletedComments,
    deletedAnalyses,
    deletedExposures,
    deletedSnapshots,
    deletedWorks,
  ] = await Promise.all([
    removeDocuments(comments, RecommendComment),
    removeDocuments(analyses, RecommendCommentAnalysis),
    removeDocuments(exposures, RecommendExposure),
    removeDocuments(snapshots, RecommendAuthorSnapshot),
    removeDocuments(works, RecommendWork),
  ]);

  const authorCleanup = await cleanupRecommendAuthors(authorKeys);

  return {
    requested: safeWorkIds.length,
    matched: works.length,
    deletedWorks,
    deletedComments,
    deletedAnalyses,
    deletedExposures,
    deletedSnapshots,
    deletedAuthors: authorCleanup.deletedAuthors,
    rebuiltAuthorIds: authorCleanup.rebuiltAuthorIds,
  };
}
