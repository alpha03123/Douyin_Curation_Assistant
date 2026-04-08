import { z } from "zod";
import { recommendFeedDiscoveryService } from "../services/discovery/recommendFeedDiscoveryService.js";
import { deleteRecommendRunById } from "../services/recommend/recommendCleanupService.js";

const recommendFeedStartSchema = z.object({
  targetUrl: z.string().url().optional(),
  headless: z.boolean().optional(),
  commentLimit: z.coerce.number().int().positive().max(100).optional(),
  maxItems: z.coerce.number().int().positive().max(500).optional(),
  maxDurationMs: z.coerce.number().int().positive().optional(),
  skipLive: z.boolean().optional(),
  preferNativeAutoplay: z.boolean().optional(),
  nativeAutoplayMaxSeconds: z.coerce.number().int().positive().max(3600).optional(),
  manualAdvanceBaseSeconds: z.coerce.number().int().positive().max(600).optional(),
  manualAdvanceJitterSeconds: z.coerce.number().int().min(0).max(30).optional(),
});

function writeSseEvent(res, eventName, payload) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function getRecommendFeedStatus(req, res) {
  res.json({ data: recommendFeedDiscoveryService.getStatus() });
}

export async function startRecommendFeed(req, res, next) {
  try {
    const payload = recommendFeedStartSchema.parse(req.body || {});
    const result = await recommendFeedDiscoveryService.start(payload);
    res.status(202).json({ data: result });
  } catch (error) {
    next(error);
  }
}

export async function stopRecommendFeed(req, res, next) {
  try {
    const result = await recommendFeedDiscoveryService.stop("manual_stop");
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
}

export function streamRecommendFeed(req, res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  writeSseEvent(res, "status", recommendFeedDiscoveryService.getStatus());
  for (const log of recommendFeedDiscoveryService.getStatus().recentLogs) {
    writeSseEvent(res, "log", log);
  }

  const offLog = recommendFeedDiscoveryService.onLog((log) => {
    writeSseEvent(res, "log", log);
  });
  const offStatus = recommendFeedDiscoveryService.onStatus((status) => {
    writeSseEvent(res, "status", status);
  });

  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    offLog();
    offStatus();
    res.end();
  });
}

export async function listRecommendRuns(req, res, next) {
  try {
    const runs = await recommendFeedDiscoveryService.listRuns(req.query || {});
    res.json({ data: runs });
  } catch (error) {
    next(error);
  }
}

export async function getRecommendRun(req, res, next) {
  try {
    const run = await recommendFeedDiscoveryService.getRun(req.params.runId);
    res.json({ data: run });
  } catch (error) {
    next(error);
  }
}

export async function listRecommendRunExposures(req, res, next) {
  try {
    const exposures = await recommendFeedDiscoveryService.listExposures(
      req.params.runId,
      req.query || {}
    );
    res.json({ data: exposures });
  } catch (error) {
    next(error);
  }
}

export async function deleteRecommendRun(req, res, next) {
  try {
    const result = await deleteRecommendRunById(req.params.runId);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
}
