import { RecommendWork } from "../../models/RecommendWork.js";
import { Work } from "../../models/Work.js";
import { executeBrowserLabTask } from "../douyin/browserLabActionService.js";

function createHttpError(message, statusCode = 500, code = null, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function buildDirectTask({ actionType, commentText = "" } = {}) {
  const safeActionType = String(actionType || "").trim();
  if (!["like", "collect", "follow", "comment"].includes(safeActionType)) {
    throw createHttpError(
      `Unsupported action type: ${safeActionType}`,
      400,
      "ACTION_TYPE_UNSUPPORTED"
    );
  }

  if (safeActionType === "comment" && !String(commentText || "").trim()) {
    throw createHttpError(
      "Comment text is required for direct comment actions.",
      422,
      "DIRECT_COMMENT_TEXT_REQUIRED"
    );
  }

  return {
    actionType: safeActionType,
    draftText: safeActionType === "comment" ? String(commentText || "").trim() : "",
  };
}

function summarizeExecutionResult(result = {}) {
  const actionResult = result?.actionResult || {};
  return {
    method: result?.method || "browser-lab",
    workUrl: result?.workUrl || "",
    actionType: actionResult?.actionType || "",
    ok: actionResult?.ok !== false,
    skipped: Boolean(actionResult?.skipped),
    reason: actionResult?.reason || "",
    status: Number(actionResult?.status || 0),
  };
}

async function loadCandidateWork(workId) {
  const work = await Work.findById(workId);
  if (!work) {
    throw createHttpError("Candidate work not found.", 404, "WORK_NOT_FOUND");
  }

  return work;
}

async function loadRecommendWork(workId) {
  const work = await RecommendWork.findById(workId);
  if (!work) {
    throw createHttpError("Recommend work not found.", 404, "RECOMMEND_WORK_NOT_FOUND");
  }

  return work;
}

async function runDirectActionWithWork(work, payload = {}, options = {}) {
  const task = buildDirectTask(payload);
  const executionResult = await executeBrowserLabTask(task, work, {
    ...options,
    sessionProfileKeys: ["recommend"],
  });

  return {
    workId: String(work._id || ""),
    actionType: task.actionType,
    executionResult: summarizeExecutionResult(executionResult),
  };
}

export async function executeCandidateWorkDirectAction(workId, payload = {}, options = {}) {
  const work = await loadCandidateWork(workId);
  return runDirectActionWithWork(work, payload, options);
}

export async function executeRecommendWorkDirectAction(workId, payload = {}, options = {}) {
  const work = await loadRecommendWork(workId);
  return runDirectActionWithWork(work, payload, options);
}
