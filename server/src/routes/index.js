import { Router } from "express";
import {
  runCandidateWorkDirectAction,
  runRecommendWorkDirectAction,
} from "../controllers/directActionController.js";
import {
  createBrowserSession,
  deleteBrowserSession,
  getBrowserSession,
} from "../controllers/browserSessionController.js";
import {
  getAnalysisForWork,
  runAnalysisForWork,
  runBatchAnalysis,
} from "../controllers/commentAnalysisController.js";
import {
  getContinuousDiscoveryStatus,
  startContinuousDiscovery,
  stopContinuousDiscovery,
  streamContinuousDiscovery,
} from "../controllers/continuousDiscoveryController.js";
import {
  listCreatorCandidates,
  rebuildCreatorCandidates,
  updateCreatorCandidate,
} from "../controllers/creatorCandidateController.js";
import { getDashboard } from "../controllers/dashboardController.js";
import { discoverWorksByKeyword } from "../controllers/discoveryController.js";
import {
  createDownloadTask,
  getTask,
  listTaskFiles,
  listTasks,
  resolveSource,
  retryTask,
} from "../controllers/downloadController.js";
import { getHealth } from "../controllers/healthController.js";
import {
  createKeyword,
  deleteKeyword,
  listKeywords,
  updateKeyword,
} from "../controllers/keywordController.js";
import {
  deleteRecommendRun,
  getRecommendFeedStatus,
  getRecommendRun,
  listRecommendRunExposures,
  listRecommendRuns,
  startRecommendFeed,
  stopRecommendFeed,
  streamRecommendFeed,
} from "../controllers/recommendFeedController.js";
import {
  getRecommendAuthorDetail,
  listRecommendAuthors,
} from "../controllers/recommendAuthorController.js";
import { getRecommendInsights } from "../controllers/recommendInsightsController.js";
import {
  batchDeleteRecommendWorksController,
  getRecommendWorkDetail,
  listRecommendWorks,
} from "../controllers/recommendWorkController.js";
import { getRoadmap } from "../controllers/roadmapController.js";
import {
  actionRulesDisabled,
  dictionaryDisabled,
  reviewQueueDisabled,
  templatesDisabled,
} from "../controllers/legacyModuleController.js";
import { batchDeleteWorks, listWorks } from "../controllers/workController.js";

const router = Router();

router.get("/health", getHealth);
router.get("/action-rules", actionRulesDisabled);
router.post("/action-rules", actionRulesDisabled);
router.put("/action-rules/:ruleId", actionRulesDisabled);
router.delete("/action-rules/:ruleId", actionRulesDisabled);
router.post("/action-rules/apply", actionRulesDisabled);
router.get("/analysis/dictionary", dictionaryDisabled);
router.get("/analysis/dictionary/word-cloud", dictionaryDisabled);
router.put("/analysis/dictionary", dictionaryDisabled);
router.post("/analysis/works/run-batch", runBatchAnalysis);
router.get("/analysis/works/:workId", getAnalysisForWork);
router.post("/analysis/works/:workId/run", runAnalysisForWork);
router.get("/browser-session", getBrowserSession);
router.post("/browser-session", createBrowserSession);
router.delete("/browser-session", deleteBrowserSession);
router.get("/creator-candidates", listCreatorCandidates);
router.post("/creator-candidates/rebuild", rebuildCreatorCandidates);
router.put("/creator-candidates/:creatorId", updateCreatorCandidate);
router.get("/dashboard", getDashboard);
router.post("/download/resolve-source", resolveSource);
router.get("/download/tasks", listTasks);
router.post("/download/tasks", createDownloadTask);
router.get("/download/tasks/:taskId", getTask);
router.get("/download/tasks/:taskId/files", listTaskFiles);
router.post("/download/tasks/:taskId/retry", retryTask);
router.get("/discovery/continuous", getContinuousDiscoveryStatus);
router.post("/discovery/continuous/start", startContinuousDiscovery);
router.post("/discovery/continuous/stop", stopContinuousDiscovery);
router.get("/discovery/continuous/stream", streamContinuousDiscovery);
router.get("/discovery/recommend", getRecommendFeedStatus);
router.post("/discovery/recommend/start", startRecommendFeed);
router.post("/discovery/recommend/stop", stopRecommendFeed);
router.get("/discovery/recommend/stream", streamRecommendFeed);
router.get("/discovery/recommend/runs", listRecommendRuns);
router.get("/discovery/recommend/runs/:runId", getRecommendRun);
router.get("/discovery/recommend/runs/:runId/exposures", listRecommendRunExposures);
router.delete("/discovery/recommend/runs/:runId", deleteRecommendRun);
router.get("/recommend/authors", listRecommendAuthors);
router.get("/recommend/authors/:authorId", getRecommendAuthorDetail);
router.get("/recommend/insights", getRecommendInsights);
router.get("/recommend/works", listRecommendWorks);
router.post("/recommend/works/batch-delete", batchDeleteRecommendWorksController);
router.get("/recommend/works/:workId", getRecommendWorkDetail);
router.post("/recommend/works/:workId/direct-action", runRecommendWorkDirectAction);
router.get("/keywords", listKeywords);
router.post("/keywords", createKeyword);
router.put("/keywords/:keywordId", updateKeyword);
router.delete("/keywords/:keywordId", deleteKeyword);
router.post("/keywords/:keywordId/discover", discoverWorksByKeyword);
router.get("/works", listWorks);
router.post("/works/batch-delete", batchDeleteWorks);
router.post("/works/:workId/direct-action", runCandidateWorkDirectAction);
router.get("/review-queue", reviewQueueDisabled);
router.put("/action-tasks/:taskId", reviewQueueDisabled);
router.post("/action-tasks/:taskId/execute", reviewQueueDisabled);
router.post("/works/:workId/execute-actions", reviewQueueDisabled);
router.get("/action-tasks/:taskId/logs", reviewQueueDisabled);
router.post("/action-tasks/execute-approved", reviewQueueDisabled);
router.get("/templates", templatesDisabled);
router.get("/templates/suggestions", templatesDisabled);
router.post("/templates", templatesDisabled);
router.post("/templates/import-from-comments", templatesDisabled);
router.put("/templates/:templateId", templatesDisabled);
router.delete("/templates/:templateId", templatesDisabled);
router.get("/roadmap", getRoadmap);

export default router;
