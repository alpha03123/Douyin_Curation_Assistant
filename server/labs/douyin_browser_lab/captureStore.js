import path from "node:path";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { once } from "node:events";

function trimText(value = "", limit = 16000) {
  const safeValue = String(value ?? "");
  if (safeValue.length <= limit) {
    return safeValue;
  }

  return `${safeValue.slice(0, limit)}\n...[truncated]`;
}

function createInitialSummary({ sessionId, filterMode }) {
  return {
    sessionId,
    filterMode,
    startedAt: new Date().toISOString(),
    endedAt: null,
    eventCounts: {},
    pageCount: 0,
    requestCount: 0,
    responseCount: 0,
    failedRequestCount: 0,
    markerCount: 0,
    healthChecks: 0,
  };
}

export class CaptureStore {
  constructor({ rootDir, sessionId, filterMode }) {
    this.rootDir = rootDir;
    this.sessionId = sessionId;
    this.filterMode = filterMode;
    this.sessionDir = path.resolve(rootDir, sessionId);
    this.liveFilePath = path.resolve(this.sessionDir, "live.ndjson");
    this.summaryFilePath = path.resolve(this.sessionDir, "summary.json");
    this.stream = null;
    this.sequence = 0;
    this.summary = createInitialSummary({ sessionId, filterMode });
  }

  async init() {
    await mkdir(this.sessionDir, { recursive: true });
    this.stream = createWriteStream(this.liveFilePath, {
      flags: "a",
      encoding: "utf8",
    });

    this.append({
      type: "session-start",
      payload: {
        sessionId: this.sessionId,
        filterMode: this.filterMode,
      },
    });
  }

  append(event = {}) {
    if (!this.stream) {
      throw new Error("CaptureStore has not been initialized.");
    }

    const record = {
      seq: ++this.sequence,
      createdAt: new Date().toISOString(),
      ...event,
    };
    const line = `${JSON.stringify(record)}\n`;
    this.stream.write(line);
    this.updateSummary(record);
    return record;
  }

  updateSummary(record) {
    const type = record.type || "unknown";
    this.summary.eventCounts[type] = (this.summary.eventCounts[type] || 0) + 1;

    if (type === "page-attached") {
      this.summary.pageCount += 1;
    }

    if (type === "request") {
      this.summary.requestCount += 1;
    }

    if (type === "response") {
      this.summary.responseCount += 1;
    }

    if (type === "request-failed") {
      this.summary.failedRequestCount += 1;
    }

    if (type === "manual-marker") {
      this.summary.markerCount += 1;
    }

    if (type === "session-health") {
      this.summary.healthChecks += 1;
    }
  }

  async close(extra = {}) {
    if (!this.stream) {
      return;
    }

    this.summary.endedAt = new Date().toISOString();
    const finalPayload = {
      sessionId: this.sessionId,
      summaryFilePath: this.summaryFilePath,
      ...extra,
    };

    this.append({
      type: "session-end",
      payload: finalPayload,
    });

    this.stream.end();
    await once(this.stream, "finish").catch(() => {});

    await writeFile(
      this.summaryFilePath,
      JSON.stringify(
        {
          ...this.summary,
          notes: trimText(extra.notes || "", 4000),
        },
        null,
        2
      ),
      "utf8"
    );

    this.stream = null;
  }
}

export { trimText };
