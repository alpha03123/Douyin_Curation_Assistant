import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { OperationLog } from "../../models/OperationLog.js";
import { RecommendExposure } from "../../models/RecommendExposure.js";
import { RecommendRun } from "../../models/RecommendRun.js";
import { RecommendWork } from "../../models/RecommendWork.js";
import {
  advanceRecommendFeed,
  buildNativeAutoplayTimeoutMs,
  closeRecommendFeedModal,
  collectVisibleFeedCards,
  getContextCookieString,
  getActiveFeedCard,
  inspectRecommendFeedSession,
  setAutoplayEnabled,
  openRecommendFeedBrowserSession,
  waitForFeedTransition,
} from "../douyin/recommendFeedBrowserService.js";
import { getAwemeDetail } from "../douyin/download/detailResolver.js";
import { fetchDouyinUserProfile } from "../douyin/userProfileService.js";
import { mapAwemeDetailToWorkDocument } from "../douyin/workMapper.js";
import { analyzeRecommendWorkComments } from "../recommend/recommendCommentAnalysisService.js";
import {
  buildRecommendAuthorKey,
  upsertRecommendAuthorProfileFromWork,
} from "../recommend/recommendAuthorService.js";
import { writeRuntimeSessionSnapshot } from "../douyin/runtimeSessionCacheService.js";

const DEFAULT_TARGET_URL = "https://www.douyin.com/?recommend=1";
const MAX_LOGS = 200;

function nowIso() {
  return new Date().toISOString();
}

function createHttpError(message, statusCode = 500, code = null, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
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

function normalizeTargetUrl(value = "") {
  const safeValue = String(value || "").trim();
  return safeValue || DEFAULT_TARGET_URL;
}

function normalizeConfig(options = {}) {
  return {
    targetUrl: normalizeTargetUrl(options.targetUrl),
    headless: Boolean(options.headless),
    commentLimit: Math.max(5, Math.min(Number(options.commentLimit) || 30, 100)),
    maxItems: Math.max(1, Math.min(Number(options.maxItems) || 50, 500)),
    maxDurationMs: Math.max(
      60000,
      Math.min(Number(options.maxDurationMs) || 30 * 60 * 1000, 12 * 60 * 60 * 1000)
    ),
    skipLive: options.skipLive === undefined ? true : Boolean(options.skipLive),
    preferNativeAutoplay:
      options.preferNativeAutoplay === undefined
        ? true
        : Boolean(options.preferNativeAutoplay),
    nativeAutoplayMaxSeconds: Math.max(
      10,
      Math.min(Number(options.nativeAutoplayMaxSeconds) || 120, 3600)
    ),
    manualAdvanceBaseSeconds: Math.max(
      1,
      Math.min(Number(options.manualAdvanceBaseSeconds) || 10, 600)
    ),
    manualAdvanceJitterSeconds: Math.max(
      0,
      Math.min(Number(options.manualAdvanceJitterSeconds ?? 2), 30)
    ),
  };
}

function buildExposureSnapshot(card, extra = {}) {
  return {
    href: card.href || "",
    titleGuess: card.titleGuess || "",
    authorGuess: card.authorGuess || "",
    lines: card.lines || [],
    text: card.text || "",
    top: card.top,
    left: card.left,
    width: card.width,
    height: card.height,
    visibleArea: card.visibleArea,
    itemType: card.itemType || "unknown",
    isLive: Boolean(card.isLive),
    className: card.className || "",
    ...extra,
  };
}

function pickFirstUrl(value) {
  if (typeof value === "string") {
    return value.startsWith("http") ? value : "";
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const url = pickFirstUrl(item);
      if (url) {
        return url;
      }
    }

    return "";
  }

  if (value && typeof value === "object") {
    const preferredKeys = [
      "url_list",
      "src",
      "url",
      "download_url_list",
      "origin_url_list",
    ];

    for (const key of preferredKeys) {
      if (key in value) {
        const url = pickFirstUrl(value[key]);
        if (url) {
          return url;
        }
      }
    }

    for (const nestedValue of Object.values(value)) {
      const url = pickFirstUrl(nestedValue);
      if (url) {
        return url;
      }
    }
  }

  return "";
}

function normalizeIpLocation(value = "") {
  const safeValue = String(value || "").trim();
  return safeValue.replace(/^IP属地[:：]/, "").trim();
}

function mapLegacyWorkDocumentToRecommendWork(baseDocument, options = {}) {
  const authorKey = buildRecommendAuthorKey({
    authorSecUid: baseDocument.authorSecUid,
    authorUniqueId: baseDocument.userId,
    authorNickname: baseDocument.authorName,
    userUrl: baseDocument.userUrl,
  });

  return {
    awemeId: baseDocument.awemeId,
    workUrl: baseDocument.workUrl,
    workType: baseDocument.workType,
    sourceType: "recommend",
    title: baseDocument.title,
    desc: baseDocument.desc,
    topics: baseDocument.topics || [],
    images: baseDocument.images || [],
    videoCover: baseDocument.videoCover || "",
    videoAddr: baseDocument.videoAddr || "",
    musicAddr: baseDocument.musicAddr || "",
    publishAt: options.publishAt || null,
    durationSeconds: Number(options.durationSeconds || 0),
    admireCount: Number(baseDocument.admireCount || 0),
    diggCount: Number(baseDocument.diggCount || 0),
    commentCount: Number(baseDocument.commentCount || 0),
    collectCount: Number(baseDocument.collectCount || 0),
    shareCount: Number(baseDocument.shareCount || 0),
    ipLocation: baseDocument.ipLocation || "",
    authorKey,
    authorUid: baseDocument.authorUid || "",
    authorSecUid: baseDocument.authorSecUid || "",
    authorUniqueId: baseDocument.userId || "",
    authorShortId: baseDocument.authorShortId || "",
    authorNickname: baseDocument.authorName || "",
    authorAvatar: baseDocument.authorAvatar || "",
    authorSignature: baseDocument.userDesc || "",
    authorCustomVerify: baseDocument.authorCustomVerify || "",
    authorEnterpriseVerifyReason: baseDocument.authorEnterpriseVerifyReason || "",
    authorVerificationType: Number(baseDocument.authorVerificationType || 0),
    userUrl: baseDocument.userUrl || "",
    followingCount: Number(baseDocument.followingCount || 0),
    followerCount: Number(baseDocument.followerCount || 0),
    totalFavorited: Number(baseDocument.totalFavorited || 0),
    awemeCount: Number(baseDocument.awemeCount || 0),
    userAge:
      baseDocument.userAge === undefined || baseDocument.userAge === null
        ? null
        : Number(baseDocument.userAge),
    gender: baseDocument.gender || "unknown",
    country: baseDocument.country || "",
    province: baseDocument.province || "",
    city: baseDocument.city || "",
    district: baseDocument.district || "",
    rawDetailJson: options.rawDetailJson || {},
  };
}

function enrichRecommendWorkWithUserProfile(baseWork, userProfilePayload = {}) {
  const user = userProfilePayload?.user || {};
  return {
    ...baseWork,
    authorUid: String(user.uid || baseWork.authorUid || ""),
    authorSecUid: String(user.sec_uid || baseWork.authorSecUid || ""),
    authorUniqueId: String(user.unique_id || baseWork.authorUniqueId || ""),
    authorShortId:
      String(user.short_id || "").trim() && String(user.short_id || "") !== "0"
        ? String(user.short_id)
        : baseWork.authorShortId || "",
    authorNickname: String(user.nickname || baseWork.authorNickname || ""),
    authorAvatar: pickFirstUrl(user.avatar_thumb || {}) || baseWork.authorAvatar || "",
    authorSignature: String(user.signature || baseWork.authorSignature || ""),
    authorCustomVerify: String(user.custom_verify || baseWork.authorCustomVerify || ""),
    authorEnterpriseVerifyReason: String(
      user.enterprise_verify_reason || baseWork.authorEnterpriseVerifyReason || ""
    ),
    authorVerificationType: Number(
      user.verification_type ?? baseWork.authorVerificationType ?? 0
    ),
    userUrl: baseWork.authorSecUid
      ? `https://www.douyin.com/user/${user.sec_uid || baseWork.authorSecUid}`
      : baseWork.userUrl || "",
    followingCount: Number(user.following_count ?? baseWork.followingCount ?? 0),
    followerCount: Number(user.follower_count ?? baseWork.followerCount ?? 0),
    totalFavorited: Number(user.total_favorited ?? baseWork.totalFavorited ?? 0),
    awemeCount: Number(user.aweme_count ?? baseWork.awemeCount ?? 0),
    userAge:
      user.user_age === undefined || user.user_age === null
        ? baseWork.userAge
        : Number(user.user_age),
    gender:
      user.gender === 1
        ? "male"
        : user.gender === 0
          ? "female"
          : baseWork.gender || "unknown",
    ipLocation: normalizeIpLocation(user.ip_location || baseWork.ipLocation || ""),
    country: String(user.country || baseWork.country || ""),
    province: String(user.province || baseWork.province || ""),
    city: String(user.city || baseWork.city || ""),
    district: String(user.district || baseWork.district || ""),
  };
}

function pickManualAdvanceWaitMs(config = {}) {
  const baseSeconds = Number(config.manualAdvanceBaseSeconds || 10);
  const jitterSeconds = Number(config.manualAdvanceJitterSeconds || 0);
  const minSeconds = Math.max(1, baseSeconds - jitterSeconds);
  const maxSeconds = Math.max(minSeconds, baseSeconds + jitterSeconds);
  const seconds =
    minSeconds === maxSeconds
      ? minSeconds
      : minSeconds + Math.random() * (maxSeconds - minSeconds);

  return {
    waitMs: Math.round(seconds * 1000),
    waitSeconds: Math.round(seconds * 100) / 100,
  };
}

function looksLikeRecommendLive(card = {}) {
  const normalizedText = String(card.text || "")
    .replace(/\s+/g, "")
    .trim();
  const normalizedTitle = String(card.titleGuess || "")
    .replace(/\s+/g, "")
    .trim();
  const normalizedAuthor = String(card.authorGuess || "")
    .replace(/\s+/g, "")
    .trim();
  const joined = `${normalizedAuthor}${normalizedTitle}${normalizedText}`;

  return (
    Boolean(card.isLive) ||
    String(card.itemType || "") === "live" ||
    /live\.douyin\.com|\/live(\/|$|\?)/i.test(String(card.href || "")) ||
    joined.includes("\u6b63\u5728\u76f4\u64ad") ||
    joined.includes("\u76f4\u64ad\u4e2d") ||
    joined.includes("\u5f00\u64ad\u4e2d")
  );
}

class RecommendFeedDiscoveryService {
  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100);
    this.logs = [];
    this.running = false;
    this.runId = "";
    this.pendingStopReason = "";
    this.hasFinishedCurrentRun = false;
    this.workerPromise = null;
    this.state = this.createIdleState();
  }

  createIdleState() {
    return {
      running: false,
      transitionState: "idle",
      runId: "",
      startedAt: null,
      stoppedAt: null,
      lastHeartbeatAt: null,
      stopReason: "",
      config: null,
      totals: {
        seenCount: 0,
        uniqueCount: 0,
        duplicateCount: 0,
        liveSkippedCount: 0,
        analyzedCount: 0,
        failedCount: 0,
      },
    };
  }

  getStatus() {
    return {
      ...this.state,
      isSettling: Boolean(this.workerPromise) && !this.running,
      recentLogs: this.logs.slice(-60),
    };
  }

  setTransitionState(transitionState = "idle") {
    this.state.transitionState = transitionState;
  }

  emitStatus() {
    this.emitter.emit("status", this.getStatus());
  }

  appendLog(level, message, payload = null) {
    const entry = {
      id: crypto.randomUUID(),
      level,
      message,
      payload,
      createdAt: nowIso(),
    };

    this.logs.push(entry);
    if (this.logs.length > MAX_LOGS) {
      this.logs.shift();
    }

    this.state.lastHeartbeatAt = entry.createdAt;
    this.emitter.emit("log", entry);
    this.emitStatus();
    return entry;
  }

  onLog(listener) {
    this.emitter.on("log", listener);
    return () => this.emitter.off("log", listener);
  }

  onStatus(listener) {
    this.emitter.on("status", listener);
    return () => this.emitter.off("status", listener);
  }

  async syncRunRecord(extraPatch = {}) {
    if (!this.runId) {
      return null;
    }

    const summaryPatch = extraPatch.summary || {};
    return RecommendRun.findByIdAndUpdate(
      this.runId,
      {
        $set: {
          status: this.state.running ? "running" : extraPatch.status || "stopped",
          lastHeartbeatAt: this.state.lastHeartbeatAt,
          stopReason: this.state.stopReason,
          endedAt: this.state.stoppedAt,
          totals: this.state.totals,
          summary: {
            recentLogCount: this.logs.length,
            lastLogAt: this.state.lastHeartbeatAt,
            ...summaryPatch,
          },
          ...extraPatch,
        },
      },
      {
        new: true,
      }
    );
  }

  async start(options = {}) {
    if (this.running) {
      throw createHttpError("Recommend feed discovery is already running.", 409);
    }

    if (this.workerPromise) {
      throw createHttpError(
        "The previous recommend feed session is still cleaning up its browser context. Wait a moment and retry.",
        409,
        "RECOMMEND_RUN_CLEANUP_PENDING"
      );
    }

    const config = normalizeConfig(options);
    const startedAt = nowIso();
    const runRecord = await RecommendRun.create({
      status: "running",
      targetUrl: config.targetUrl,
      headless: config.headless,
      commentLimit: config.commentLimit,
      maxItems: config.maxItems,
      maxDurationMs: config.maxDurationMs,
      skipLive: config.skipLive,
      preferNativeAutoplay: config.preferNativeAutoplay,
      nativeAutoplayMaxSeconds: config.nativeAutoplayMaxSeconds,
      startedAt,
      lastHeartbeatAt: startedAt,
      config,
      summary: {
        phase: "initialized",
      },
    });

    this.running = true;
    this.runId = String(runRecord._id);
    this.pendingStopReason = "";
    this.hasFinishedCurrentRun = false;
    this.logs = [];
    this.state = {
      running: true,
      transitionState: "starting",
      runId: this.runId,
      startedAt,
      stoppedAt: null,
      lastHeartbeatAt: startedAt,
      stopReason: "",
      config,
      totals: {
        seenCount: 0,
        uniqueCount: 0,
        duplicateCount: 0,
        liveSkippedCount: 0,
        analyzedCount: 0,
        failedCount: 0,
      },
    };

    this.appendLog("info", "Recommend feed discovery started.", {
      runId: this.runId,
      ...config,
    });

    await writeOperationLog(
      "recommend.run",
      "success",
      "Recommend feed discovery started.",
      {
        runId: this.runId,
        ...config,
      }
    );

    const workerPromise = this.runLoop()
      .catch(async (error) => {
        this.appendLog("error", `Recommend feed discovery crashed: ${error.message}`, {
          runId: this.runId,
          code: error.code || "",
        });
        await this.finish("error", {
          status: "failed",
          summary: {
            error: error.message,
            code: error.code || "",
          },
        });
      })
      .finally(() => {
        if (this.workerPromise === workerPromise) {
          this.workerPromise = null;
        }

        if (!this.running) {
          this.setTransitionState("idle");
          this.emitStatus();
        }
      });
    this.workerPromise = workerPromise;

    this.emitStatus();
    return this.getStatus();
  }

  async stop(reason = "manual_stop") {
    if (!this.running && !this.workerPromise) {
      return this.getStatus();
    }

    if (this.state.transitionState === "stopping") {
      return this.getStatus();
    }

    this.pendingStopReason = reason;
    this.running = false;
    this.state.running = false;
    this.setTransitionState("stopping");
    this.state.stopReason = reason;
    this.appendLog("warning", `Recommend feed discovery stop requested: ${reason}`, {
      runId: this.runId,
    });
    await this.syncRunRecord({
      summary: {
        pendingStopReason: reason,
      },
    });
    return this.getStatus();
  }

  async finish(reason, extraPatch = {}) {
    if (this.hasFinishedCurrentRun) {
      return this.getStatus();
    }

    this.hasFinishedCurrentRun = true;
    this.running = false;
    this.state.running = false;
    this.setTransitionState(reason === "manual_stop" ? "stopping" : "finishing");
    this.state.stopReason = reason;
    this.state.stoppedAt = nowIso();

    const status =
      extraPatch.status ||
      (reason === "error"
        ? "failed"
        : reason === "verify_check"
          ? "verify_check"
          : "stopped");
    await this.syncRunRecord({
      status,
      ...extraPatch,
    });
    await writeOperationLog(
      "recommend.run",
      status === "failed" ? "error" : "info",
      `Recommend feed discovery finished: ${reason}.`,
      {
        runId: this.runId,
        totals: this.state.totals,
        status,
      }
    );

    this.emitStatus();
    return this.getStatus();
  }

  async recordExposure(payload = {}) {
    if (!this.runId) {
      throw createHttpError("No active recommend feed run exists.", 409);
    }

    const exposureIndex = Number(payload.exposureIndex) || this.state.totals.seenCount + 1;
    const exposedAt = payload.exposedAt || nowIso();
    const exposureKey =
      payload.exposureKey ||
      `${this.runId}:${String(payload.awemeId || payload.href || "unknown")}:${exposureIndex}:${exposedAt}`;

    const exposure = await RecommendExposure.create({
      exposureKey,
      runId: this.runId,
      workId: String(payload.workId || ""),
      awemeId: String(payload.awemeId || ""),
      exposureIndex,
      exposedAt,
      itemType: String(payload.itemType || "unknown"),
      skipped: Boolean(payload.skipped),
      skipReason: String(payload.skipReason || ""),
      duplicateInRun: Boolean(payload.duplicateInRun),
      advanceMethod: String(payload.advanceMethod || "scroll"),
      analysisStatus: String(payload.analysisStatus || "pending"),
      snapshot: payload.snapshot || {},
      rawJson: payload.rawJson || {},
    });

    this.state.totals.seenCount += 1;
    if (payload.duplicateInRun) {
      this.state.totals.duplicateCount += 1;
    } else {
      this.state.totals.uniqueCount += 1;
    }
    if (payload.skipped && payload.skipReason === "live") {
      this.state.totals.liveSkippedCount += 1;
    }

    this.appendLog(
      payload.skipped ? "warning" : "info",
      payload.skipped
        ? `Exposure ${exposureIndex} skipped: ${payload.skipReason || "unknown"}.`
        : `Exposure ${exposureIndex} recorded for aweme ${payload.awemeId || "-"}.`,
      {
        runId: this.runId,
        awemeId: payload.awemeId || "",
        itemType: payload.itemType || "unknown",
        exposureId: exposure._id,
      }
    );
    await this.syncRunRecord();
    return exposure;
  }

  async updateExposure(exposureId, payload = {}) {
    if (!exposureId) {
      return null;
    }

    return RecommendExposure.findByIdAndUpdate(
      exposureId,
      {
        $set: payload,
      },
      {
        new: true,
      }
    );
  }

  async recordAnalysisResult({ success = true, count = 1 } = {}) {
    if (success) {
      this.state.totals.analyzedCount += Math.max(1, Number(count) || 1);
    } else {
      this.state.totals.failedCount += Math.max(1, Number(count) || 1);
    }
    await this.syncRunRecord();
    this.emitStatus();
  }

  async upsertRecommendWork(awemeId, card, cookieString) {
    const existing = await RecommendWork.findOne({ awemeId: String(awemeId) });
    const workUrl =
      card.href || `https://www.douyin.com/${card.itemType === "image" ? "note" : "video"}/${awemeId}`;
    const detail = await getAwemeDetail(String(awemeId), workUrl, cookieString);
    const secUserId =
      detail?.author?.sec_uid || existing?.authorSecUid || card?.profileHref?.split("/user/")[1]?.split("?")[0] || "";
    let userProfilePayload = null;
    if (secUserId) {
      try {
        userProfilePayload = await fetchDouyinUserProfile({
          cookieString,
          secUserId,
          userUrl: detail?.author?.sec_uid
            ? `https://www.douyin.com/user/${detail.author.sec_uid}`
            : existing?.userUrl || "",
        });
      } catch (error) {
        this.appendLog("warning", `Failed to enrich author profile for aweme ${awemeId}.`, {
          runId: this.runId,
          awemeId,
          code: error.code || "",
        });
      }
    }

    const legacyWorkDocument = mapAwemeDetailToWorkDocument(detail, {
      discoverySource: "recommend",
      sourceLabel: "recommend",
      keywordSource: "",
      rawJson: {
        aweme_info: detail,
        user_profile: userProfilePayload || {},
        recommendSnapshot: buildExposureSnapshot(card),
      },
    });

    if (!legacyWorkDocument) {
      throw createHttpError(
        `Unable to map aweme detail ${awemeId} into a work document.`,
        502,
        "RECOMMEND_WORK_MAPPING_FAILED"
      );
    }

    const now = nowIso();
    const nextSeenCount = Math.max(1, Number(existing?.seenCount || 0) + 1);
    const recommendWorkDocument = enrichRecommendWorkWithUserProfile(
      mapLegacyWorkDocumentToRecommendWork(legacyWorkDocument, {
        durationSeconds: Number(card?.videoState?.duration || 0),
        publishAt: detail?.create_time
          ? new Date(Number(detail.create_time) * 1000).toISOString()
          : null,
        rawDetailJson: {
          aweme_info: detail,
          user_profile: userProfilePayload || {},
          recommendSnapshot: buildExposureSnapshot(card),
        },
      }),
      userProfilePayload
    );

    return RecommendWork.findOneAndUpdate(
      { awemeId: recommendWorkDocument.awemeId },
      {
        $set: {
          ...recommendWorkDocument,
          firstSeenAt: existing?.firstSeenAt || now,
          lastSeenAt: now,
          seenCount: nextSeenCount,
          lastRunId: this.runId,
          latestExposureId: "",
        },
        $setOnInsert: {
          firstSeenAt: now,
        },
      },
      {
        new: true,
        upsert: true,
      }
    );
  }

  async markHeartbeat(summary = {}) {
    this.state.lastHeartbeatAt = nowIso();
    await this.syncRunRecord({
      summary,
    });
    this.emitStatus();
  }

  hasReachedDurationLimit() {
    const elapsedMs =
      new Date().getTime() - new Date(this.state.startedAt || nowIso()).getTime();
    return elapsedMs >= this.state.config.maxDurationMs;
  }

  async waitForNativeAutoplayTransition(page, currentCard) {
    const timeoutMs = Math.min(
      buildNativeAutoplayTimeoutMs(currentCard),
      Number(this.state.config.nativeAutoplayMaxSeconds || 120) * 1000
    );
    this.appendLog(
      "info",
      `Waiting for native autoplay to switch after aweme ${currentCard.awemeId}.`,
      {
        runId: this.runId,
        mode: "native_autoplay",
        currentAwemeId: currentCard.awemeId,
        timeoutMs,
        nativeAutoplayMaxSeconds: this.state.config.nativeAutoplayMaxSeconds,
      }
    );

    const transition = await waitForFeedTransition(page, {
      previousAwemeId: currentCard.awemeId,
      timeoutMs,
    });

    if (!transition.changed) {
      this.appendLog(
        "warning",
        `Native autoplay timed out on aweme ${currentCard.awemeId}; falling back to manual advance.`,
        {
          runId: this.runId,
          mode: "native_autoplay",
          currentAwemeId: currentCard.awemeId,
          timeoutMs,
          waitedMs: transition.waitedMs,
        }
      );

      const advanceResult = await advanceRecommendFeed(page);
      if (!advanceResult.advanced) {
        throw createHttpError(
          `Native autoplay timeout fallback failed on aweme ${currentCard.awemeId}.`,
          409,
          "RECOMMEND_NATIVE_AUTOPLAY_TIMEOUT",
          {
            currentAwemeId: currentCard.awemeId,
            timeoutMs,
            waitedMs: transition.waitedMs,
            advanceResult,
          }
        );
      }

      const fallbackTransition = await waitForFeedTransition(page, {
        previousAwemeId: currentCard.awemeId,
        timeoutMs: 10_000,
      });

      if (!fallbackTransition.changed) {
        throw createHttpError(
          `Native autoplay fallback did not switch away from aweme ${currentCard.awemeId}.`,
          409,
          "RECOMMEND_NATIVE_AUTOPLAY_TIMEOUT",
          {
            currentAwemeId: currentCard.awemeId,
            timeoutMs,
            waitedMs: transition.waitedMs,
            nextAwemeId: fallbackTransition.nextAwemeId,
          }
        );
      }

      this.appendLog("success", "Native autoplay timeout fallback switched to the next aweme.", {
        runId: this.runId,
        mode: "native_autoplay",
        currentAwemeId: currentCard.awemeId,
        nextAwemeId: fallbackTransition.nextAwemeId,
      });
      return;
    }

    this.appendLog("success", "Detected native autoplay transition.", {
      runId: this.runId,
      mode: "native_autoplay",
      currentAwemeId: currentCard.awemeId,
      nextAwemeId: transition.nextAwemeId,
      waitedMs: transition.waitedMs,
    });
  }

  async waitForManualAdvanceTransition(page, currentCard, cycleStartedAt) {
    const waitPlan = pickManualAdvanceWaitMs(this.state.config);
    const elapsedMs = Date.now() - cycleStartedAt;
    const remainingMs = Math.max(0, waitPlan.waitMs - elapsedMs);

    this.appendLog("info", "Waiting before manual feed advance.", {
      runId: this.runId,
      mode: "manual_interval",
      currentAwemeId: currentCard.awemeId,
      waitSeconds: waitPlan.waitSeconds,
      remainingMs,
    });

    if (remainingMs > 0) {
      await page.waitForTimeout(remainingMs);
    }

    const advanceResult = await advanceRecommendFeed(page);
    if (!advanceResult.advanced) {
      throw createHttpError(
        `Manual advance failed on aweme ${currentCard.awemeId}.`,
        409,
        "RECOMMEND_MANUAL_ADVANCE_FAILED",
        {
          currentAwemeId: currentCard.awemeId,
          advanceResult,
        }
      );
    }

    this.appendLog("info", `Manual advance triggered via ${advanceResult.mode}.`, {
      runId: this.runId,
      ...advanceResult,
      mode: "manual_interval",
      currentAwemeId: currentCard.awemeId,
      advanceMode: advanceResult.mode,
    });

    const transition = await waitForFeedTransition(page, {
      previousAwemeId: currentCard.awemeId,
      timeoutMs: 10_000,
    });

    if (!transition.changed) {
      throw createHttpError(
        `Manual advance did not switch away from aweme ${currentCard.awemeId}.`,
        409,
        "RECOMMEND_MANUAL_TRANSITION_TIMEOUT",
        {
          currentAwemeId: currentCard.awemeId,
          waitedMs: transition.waitedMs,
          nextAwemeId: transition.nextAwemeId,
        }
      );
    }

    this.appendLog("success", "Detected manual feed transition.", {
      runId: this.runId,
      mode: "manual_interval",
      currentAwemeId: currentCard.awemeId,
      nextAwemeId: transition.nextAwemeId,
      waitedMs: transition.waitedMs,
      waitSeconds: waitPlan.waitSeconds,
    });
  }

  async skipLiveAndAdvance(page, currentCard) {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const advanceResult = await advanceRecommendFeed(page);
      this.appendLog(
        advanceResult.advanced ? "info" : "warning",
        advanceResult.advanced
          ? `Detected live content and tried to move to the next item. Attempt ${attempt}/${maxAttempts}.`
          : `Detected live content but could not advance on attempt ${attempt}/${maxAttempts}.`,
        {
          runId: this.runId,
          currentAwemeId: currentCard.awemeId || "",
          attempt,
          ...advanceResult,
        }
      );

      if (!advanceResult.advanced) {
        await page.waitForTimeout(900);
        continue;
      }

      const transition = await waitForFeedTransition(page, {
        previousAwemeId: currentCard.awemeId,
        timeoutMs: 8000,
      });

      if (transition.changed) {
        this.appendLog("success", "Skipped live content and detected the next aweme.", {
          runId: this.runId,
          currentAwemeId: currentCard.awemeId || "",
          nextAwemeId: transition.nextAwemeId,
          waitedMs: transition.waitedMs,
        });
        return true;
      }

      this.appendLog(
        "warning",
        `Live skip transition did not confirm a new aweme on attempt ${attempt}/${maxAttempts}.`,
        {
          runId: this.runId,
          currentAwemeId: currentCard.awemeId || "",
          nextAwemeId: transition.nextAwemeId,
          waitedMs: transition.waitedMs,
        }
      );
    }

    this.appendLog(
      "warning",
      "Live content could not be skipped after multiple attempts. The task will keep listening instead of stopping.",
      {
        runId: this.runId,
        currentAwemeId: currentCard.awemeId || "",
      }
    );
    return false;
  }

  async processCard(card, cookieString) {
    const exposure = await this.recordExposure({
      awemeId: card.awemeId || "",
      itemType: card.itemType || "unknown",
      skipped: false,
      advanceMethod: card.advanceMethod || "scroll",
      transitionMode: this.state.config.preferNativeAutoplay
        ? "native_autoplay"
        : "manual_interval",
      analysisStatus: "pending",
      snapshot: buildExposureSnapshot(card),
      rawJson: card,
    });

    try {
      const work = await this.upsertRecommendWork(card.awemeId, card, cookieString);
      const authorProfile = await upsertRecommendAuthorProfileFromWork(work, this.runId, {
        source: "recommend_work_upsert",
      });
      await this.updateExposure(String(exposure._id), {
        recommendWorkId: String(work._id),
        authorKey: work.authorKey || authorProfile?.authorKey || "",
        analysisStatus: "running",
      });

      const analysisResult = await analyzeRecommendWorkComments(String(work._id), {
        commentLimit: this.state.config.commentLimit,
        cookieString,
      });

      await this.updateExposure(String(exposure._id), {
        recommendWorkId: String(work._id),
        authorKey: work.authorKey || authorProfile?.authorKey || "",
        analysisStatus: "success",
      });
      await this.recordAnalysisResult({ success: true });
      this.appendLog("success", `Captured and analyzed work ${work.awemeId}.`, {
        runId: this.runId,
        recommendWorkId: work._id,
        awemeId: work.awemeId,
        totalScore: analysisResult.analysis?.scores?.totalScore || 0,
      });
    } catch (error) {
      await this.updateExposure(String(exposure._id), {
        analysisStatus: "failed",
      }).catch(() => {});
      await this.recordAnalysisResult({ success: false });
      this.appendLog("error", `Failed to process aweme ${card.awemeId}: ${error.message}`, {
        runId: this.runId,
        awemeId: card.awemeId,
        code: error.code || "",
      });

      if (
        error.code === "DOUYIN_VERIFY_CHECK" ||
        error.code === "DOUYIN_RUNTIME_LOGIN_REQUIRED"
      ) {
        throw error;
      }
    }
  }

  async runLoop() {
    let browserSession = null;
    const seenCardKeys = new Set();
    let stagnantRounds = 0;

    try {
      browserSession = await openRecommendFeedBrowserSession({
        targetUrl: this.state.config.targetUrl,
        headless: this.state.config.headless,
        preferNativeAutoplay: this.state.config.preferNativeAutoplay,
      });
      this.setTransitionState(this.running ? "running" : "stopping");
      this.emitStatus();

      await closeRecommendFeedModal(browserSession.page).catch(() => {});
      const initialHealth = await inspectRecommendFeedSession(
        browserSession.context,
        browserSession.page
      );
      const cookieString = await getContextCookieString(browserSession.context);
      if (cookieString) {
        const storageState = await browserSession.context.storageState().catch(() => null);
        await writeRuntimeSessionSnapshot({
          cookieString,
          storageState,
          source: "recommend-feed-browser",
          targetUrl: initialHealth.currentUrl || this.state.config.targetUrl,
        }).catch(() => null);
      }

      if (initialHealth.verificationRequired) {
        this.appendLog("warning", "Douyin requires verification before recommend discovery can continue.", {
          runId: this.runId,
          currentUrl: initialHealth.currentUrl,
        });
        await this.finish("verify_check", {
          status: "verify_check",
          summary: {
            currentUrl: initialHealth.currentUrl,
          },
        });
        return;
      }

      if (!initialHealth.loginReady) {
        this.appendLog(
          "warning",
          "Runtime browser is not logged in. The page may fall back to a non-personalized feed such as jingxuan.",
          {
            runId: this.runId,
            currentUrl: initialHealth.currentUrl,
          }
        );
      } else {
        this.appendLog("success", "Runtime browser session is logged in and ready.", {
          runId: this.runId,
          currentUrl: initialHealth.currentUrl,
        });
      }

      if (initialHealth.currentUrl !== this.state.config.targetUrl) {
        this.appendLog(
          "warning",
          "Recommend target URL redirected. The task will continue on the actual page that Douyin served.",
          {
            runId: this.runId,
            targetUrl: this.state.config.targetUrl,
            currentUrl: initialHealth.currentUrl,
          }
        );
      }

      const autoplayState = await setAutoplayEnabled(
        browserSession.page,
        this.state.config.preferNativeAutoplay
      );

      if (this.state.config.preferNativeAutoplay) {
        if (!autoplayState.found || !autoplayState.visible) {
          throw createHttpError(
            "Native autoplay mode was requested, but the Douyin autoplay control was not found.",
            409,
            "RECOMMEND_AUTOPLAY_CONTROL_NOT_FOUND",
            {
              currentUrl: initialHealth.currentUrl,
              autoplayState,
            }
          );
        }

        this.appendLog(
          autoplayState.toggled ? "success" : "info",
          autoplayState.toggled
            ? "Native autoplay/continuous-play control was enabled."
            : "Native autoplay/continuous-play control was already enabled.",
          {
            runId: this.runId,
            mode: "native_autoplay",
            autoplayState,
          }
        );
      } else if (autoplayState.found && autoplayState.visible) {
        this.appendLog(
          autoplayState.toggled ? "success" : "info",
          autoplayState.toggled
            ? "Native autoplay/continuous-play control was disabled for manual interval mode."
            : "Native autoplay/continuous-play control was already disabled for manual interval mode.",
          {
            runId: this.runId,
            mode: "manual_interval",
            autoplayState,
          }
        );
      } else {
        this.appendLog(
          "warning",
          "Manual interval mode could not find a visible native autoplay control. The task will continue with manual switching only.",
          {
            runId: this.runId,
            mode: "manual_interval",
            currentUrl: initialHealth.currentUrl,
          }
        );
      }

      while (true) {
        if (!this.running) {
          await this.finish(this.pendingStopReason || "manual_stop");
          return;
        }

        if (this.hasReachedDurationLimit()) {
          this.appendLog("warning", "Recommend feed discovery reached max duration and will stop.", {
            runId: this.runId,
          });
          await this.finish("max_duration_reached", {
            status: "success",
            summary: {
              currentUrl: browserSession.page.url(),
            },
          });
          return;
        }

        if (this.state.totals.seenCount >= this.state.config.maxItems) {
          this.appendLog("success", "Recommend feed discovery reached max items and will stop.", {
            runId: this.runId,
            seenCount: this.state.totals.seenCount,
          });
          await this.finish("max_items_reached", {
            status: "success",
            summary: {
              currentUrl: browserSession.page.url(),
            },
          });
          return;
        }

        await closeRecommendFeedModal(browserSession.page).catch(() => {});
        await this.markHeartbeat({
          currentUrl: browserSession.page.url(),
        });

        let currentCard = await getActiveFeedCard(browserSession.page);
        if (!currentCard) {
          await browserSession.page
            .locator('[data-e2e="slideList"]')
            .first()
            .hover()
            .catch(() => {});
          await browserSession.page.waitForTimeout(600);
          currentCard = await getActiveFeedCard(browserSession.page);
        }
        if (!currentCard) {
          await browserSession.page.waitForTimeout(1200);
          currentCard = await getActiveFeedCard(browserSession.page);
        }

        if (!currentCard) {
          stagnantRounds += 1;
          const advanceResult = await advanceRecommendFeed(browserSession.page);
          this.appendLog(
            advanceResult.advanced ? "info" : "warning",
            advanceResult.advanced
              ? `Recommend feed advanced via ${advanceResult.mode}.`
              : "Recommend feed could not advance further on the current page.",
            {
              runId: this.runId,
              ...advanceResult,
            }
          );

          if (!advanceResult.advanced || stagnantRounds >= 12) {
            await this.finish("no_more_visible_cards", {
              status: "success",
              summary: {
                currentUrl: browserSession.page.url(),
              },
            });
            return;
          }

          continue;
        }

        stagnantRounds = 0;

        const cycleStartedAt = Date.now();
        const cardKey =
          currentCard.awemeId || currentCard.href || `${currentCard.top}:${currentCard.left}`;
        const hasSeenCurrentCard = seenCardKeys.has(cardKey);

        if (!hasSeenCurrentCard) {
          seenCardKeys.add(cardKey);

          if (looksLikeRecommendLive(currentCard) && this.state.config.skipLive) {
            const exposure = await this.recordExposure({
              awemeId: currentCard.awemeId || "",
              itemType: currentCard.itemType || "live",
              skipped: true,
              skipReason: "live",
              advanceMethod: currentCard.advanceMethod || "scroll",
              analysisStatus: "skipped",
              snapshot: buildExposureSnapshot(currentCard, {
                currentUrl: browserSession.page.url(),
                transitionMode: this.state.config.preferNativeAutoplay
                  ? "native_autoplay"
                  : "manual_interval",
              }),
              rawJson: currentCard,
            });
            await this.updateExposure(String(exposure._id), {
              analysisStatus: "skipped",
            });
          } else if (!currentCard.awemeId) {
            const exposure = await this.recordExposure({
              awemeId: "",
              itemType: currentCard.itemType || "unknown",
              skipped: true,
              skipReason: "missing_aweme_id",
              advanceMethod: currentCard.advanceMethod || "scroll",
              analysisStatus: "skipped",
              snapshot: buildExposureSnapshot(currentCard, {
                currentUrl: browserSession.page.url(),
                transitionMode: this.state.config.preferNativeAutoplay
                  ? "native_autoplay"
                  : "manual_interval",
              }),
              rawJson: currentCard,
            });
            await this.updateExposure(String(exposure._id), {
              analysisStatus: "skipped",
            });
          } else {
            await this.processCard(
              {
                ...currentCard,
                text: currentCard.text,
              },
              cookieString
            );
          }
        }

        if (!this.running) {
          await this.finish(this.pendingStopReason || "manual_stop");
          return;
        }

        if (this.state.totals.seenCount >= this.state.config.maxItems) {
          this.appendLog("success", "Recommend feed discovery reached max items and will stop.", {
            runId: this.runId,
            seenCount: this.state.totals.seenCount,
          });
          await this.finish("max_items_reached", {
            status: "success",
            summary: {
              currentUrl: browserSession.page.url(),
            },
          });
          return;
        }

        if (looksLikeRecommendLive(currentCard) && this.state.config.skipLive) {
          await this.skipLiveAndAdvance(browserSession.page, currentCard);
          continue;
        }

        if (this.state.config.preferNativeAutoplay) {
          await this.waitForNativeAutoplayTransition(browserSession.page, currentCard);
          continue;
        }

        await this.waitForManualAdvanceTransition(
          browserSession.page,
          currentCard,
          cycleStartedAt
        );
      }
    } catch (error) {
      if (
        error.code === "RECOMMEND_TARGET_REDIRECTED" ||
        error.code === "DOUYIN_VERIFY_CHECK" ||
        error.code === "DOUYIN_RUNTIME_LOGIN_REQUIRED" ||
        error.code === "RECOMMEND_AUTOPLAY_CONTROL_NOT_FOUND" ||
        error.code === "RECOMMEND_AUTOPLAY_STATE_MISMATCH" ||
        error.code === "RECOMMEND_NATIVE_AUTOPLAY_TIMEOUT" ||
        error.code === "RECOMMEND_MANUAL_ADVANCE_FAILED" ||
        error.code === "RECOMMEND_MANUAL_TRANSITION_TIMEOUT" ||
        error.code === "RECOMMEND_LIVE_SKIP_ADVANCE_FAILED" ||
        error.code === "RECOMMEND_LIVE_SKIP_TRANSITION_TIMEOUT"
      ) {
        this.appendLog(
          error.code === "DOUYIN_VERIFY_CHECK" ? "warning" : "error",
          error.code === "RECOMMEND_TARGET_REDIRECTED"
            ? "Recommend feed target page redirected to a different URL. The task stopped immediately."
            : error.message,
          {
            runId: this.runId,
            code: error.code || "",
            ...(error.details || {}),
          }
        );
        await this.finish(
          error.code === "RECOMMEND_TARGET_REDIRECTED"
            ? "unexpected_redirect"
            : error.code === "DOUYIN_VERIFY_CHECK"
              ? "verify_check"
              : error.code === "DOUYIN_RUNTIME_LOGIN_REQUIRED"
                ? "login_required"
                : error.code === "RECOMMEND_AUTOPLAY_CONTROL_NOT_FOUND"
                  ? "autoplay_control_not_found"
                  : error.code === "RECOMMEND_AUTOPLAY_STATE_MISMATCH"
                    ? "autoplay_state_mismatch"
                    : error.code === "RECOMMEND_NATIVE_AUTOPLAY_TIMEOUT"
                      ? "native_autoplay_timeout"
                      : error.code === "RECOMMEND_MANUAL_ADVANCE_FAILED"
                        ? "manual_advance_failed"
                        : error.code === "RECOMMEND_MANUAL_TRANSITION_TIMEOUT"
                          ? "manual_transition_timeout"
                          : error.code === "RECOMMEND_LIVE_SKIP_ADVANCE_FAILED"
                            ? "live_skip_advance_failed"
                            : error.code === "RECOMMEND_LIVE_SKIP_TRANSITION_TIMEOUT"
                              ? "live_skip_transition_timeout"
                              : "error",
          {
            status: error.code === "DOUYIN_VERIFY_CHECK" ? "verify_check" : "failed",
            summary: {
              error: error.message,
              code: error.code,
              ...(error.details || {}),
            },
          }
        );
        return;
      }

      throw error;
    } finally {
      if (browserSession?.context) {
        await browserSession.context.close().catch(() => {});
      }
    }
  }

  async listRuns(options = {}) {
    const limit = Math.max(1, Math.min(Number(options.limit) || 20, 200));
    const filter = {};

    if (options.status) {
      filter.status = String(options.status);
    }

    if (options.dateFrom || options.dateTo) {
      filter.startedAt = {};
      if (options.dateFrom) {
        filter.startedAt.$gte = String(options.dateFrom);
      }
      if (options.dateTo) {
        filter.startedAt.$lte = String(options.dateTo);
      }
    }

    return RecommendRun.find(filter).sort({ startedAt: -1, updatedAt: -1 }).limit(limit);
  }

  async getRun(runId) {
    const run = await RecommendRun.findById(runId);
    if (!run) {
      throw createHttpError("Recommend run not found.", 404);
    }

    return run;
  }

  async listExposures(runId, options = {}) {
    await this.getRun(runId);

    const limit = Math.max(1, Math.min(Number(options.limit) || 100, 500));
    const filter = {
      runId: String(runId),
    };

    if (options.skipped === "true" || options.skipped === "1") {
      filter.skipped = true;
    } else if (options.skipped === "false" || options.skipped === "0") {
      filter.skipped = false;
    }

    if (options.analysisStatus) {
      filter.analysisStatus = String(options.analysisStatus);
    }

    return RecommendExposure.find(filter)
      .sort({ exposureIndex: -1, exposedAt: -1 })
      .limit(limit);
  }
}

export const recommendFeedDiscoveryService = new RecommendFeedDiscoveryService();
