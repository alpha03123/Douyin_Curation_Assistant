import { z } from "zod";
import { continuousDiscoveryService } from "../services/discovery/continuousDiscoveryService.js";

const continuousDiscoverySchema = z.object({
  pageSize: z.coerce.number().int().positive().max(25).optional(),
  requestIntervalMs: z.coerce.number().int().positive().max(60000).optional(),
  cycleIntervalMs: z.coerce.number().int().positive().max(300000).optional(),
  sortType: z.string().optional(),
  publishTime: z.string().optional(),
  filterDuration: z.string().optional(),
  searchRange: z.string().optional(),
  contentType: z.string().optional(),
  searchStrategy: z.enum(["auto", "fast", "safe"]).optional(),
});

function writeSseEvent(res, eventName, payload) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function getContinuousDiscoveryStatus(req, res) {
  res.json({ data: continuousDiscoveryService.getStatus() });
}

export function startContinuousDiscovery(req, res, next) {
  try {
    const payload = continuousDiscoverySchema.parse(req.body || {});
    const result = continuousDiscoveryService.start(payload);
    res.status(202).json({ data: result });
  } catch (error) {
    next(error);
  }
}

export function stopContinuousDiscovery(req, res, next) {
  try {
    const result = continuousDiscoveryService.stop("manual_stop");
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
}

export function streamContinuousDiscovery(req, res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  writeSseEvent(res, "status", continuousDiscoveryService.getStatus());
  for (const log of continuousDiscoveryService.getStatus().recentLogs) {
    writeSseEvent(res, "log", log);
  }

  const offLog = continuousDiscoveryService.onLog((log) => {
    writeSseEvent(res, "log", log);
  });
  const offStatus = continuousDiscoveryService.onStatus((status) => {
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
