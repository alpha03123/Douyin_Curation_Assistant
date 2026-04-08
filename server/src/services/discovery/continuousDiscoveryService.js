import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import { Keyword } from "../../models/Keyword.js";
import { discoverWorksByKeywordPage } from "./discoveryService.js";
import { KEYWORD_SEARCH_STRATEGIES } from "../douyin/searchService.js";

const MAX_LOGS = 200;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function nowIso() {
  return new Date().toISOString();
}

function createHttpError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

class ContinuousDiscoveryService {
  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100);
    this.logs = [];
    this.running = false;
    this.state = this.createIdleState();
    this.offsets = new Map();
    this.loopPromise = null;
  }

  createIdleState() {
    return {
      running: false,
      startedAt: null,
      stoppedAt: null,
      lastHeartbeatAt: null,
      stopReason: "",
      config: null,
      totals: {
        rounds: 0,
        fetchedCount: 0,
        normalizedCount: 0,
        insertedCount: 0,
        modifiedCount: 0,
      },
    };
  }

  getStatus() {
    return {
      ...this.state,
      recentLogs: this.logs.slice(-60),
    };
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

  start(options = {}) {
    if (this.running) {
      throw createHttpError("Continuous discovery is already running.", 409);
    }

    const config = {
      pageSize: Math.max(1, Math.min(Number(options.pageSize) || 20, 25)),
      requestIntervalMs: Math.max(
        1000,
        Math.min(Number(options.requestIntervalMs) || 4000, 60000)
      ),
      cycleIntervalMs: Math.max(
        1000,
        Math.min(Number(options.cycleIntervalMs) || 8000, 300000)
      ),
      sortType: String(options.sortType ?? "0"),
      publishTime: String(options.publishTime ?? "0"),
      filterDuration: String(options.filterDuration ?? ""),
      searchRange: String(options.searchRange ?? "0"),
      contentType: String(options.contentType ?? "0"),
      searchStrategy: String(options.searchStrategy ?? KEYWORD_SEARCH_STRATEGIES.AUTO),
    };

    this.running = true;
    this.offsets.clear();
    this.logs = [];
    this.state = {
      running: true,
      startedAt: nowIso(),
      stoppedAt: null,
      lastHeartbeatAt: null,
      stopReason: "",
      config,
      totals: {
        rounds: 0,
        fetchedCount: 0,
        normalizedCount: 0,
        insertedCount: 0,
        modifiedCount: 0,
      },
    };

    this.appendLog(
      "info",
      "Continuous discovery started. It will keep scanning enabled keywords until stopped manually.",
      config
    );

    this.loopPromise = this.runLoop().catch((error) => {
      this.appendLog("error", `Continuous discovery crashed: ${error.message}`);
      this.finish("error");
    });

    this.emitStatus();
    return this.getStatus();
  }

  stop(reason = "manual") {
    if (!this.running) {
      return this.getStatus();
    }

    this.appendLog("warning", `Continuous discovery stop requested: ${reason}`);
    this.finish(reason);
    return this.getStatus();
  }

  finish(reason) {
    this.running = false;
    this.state.running = false;
    this.state.stopReason = reason;
    this.state.stoppedAt = nowIso();
    this.emitStatus();
  }

  async runLoop() {
    while (this.running) {
      const keywords = await Keyword.find({ enabled: true }).sort({
        updatedAt: -1,
        createdAt: -1,
      });

      if (keywords.length === 0) {
        this.appendLog(
          "warning",
          "No enabled keywords found. Continuous discovery is waiting for a keyword to be enabled."
        );
        await sleep(this.state.config.cycleIntervalMs);
        continue;
      }

      for (const keyword of keywords) {
        if (!this.running) {
          break;
        }

        const currentOffset = this.offsets.get(keyword.id) ?? 0;

        this.appendLog(
          "info",
          `Scanning keyword "${keyword.keyword}" from offset ${currentOffset}.`,
          {
            keywordId: keyword.id,
            offset: currentOffset,
          }
        );

        try {
          const result = await discoverWorksByKeywordPage(keyword.id, {
            offset: currentOffset,
            pageSize: this.state.config.pageSize,
            sortType: this.state.config.sortType,
            publishTime: this.state.config.publishTime,
            filterDuration: this.state.config.filterDuration,
            searchRange: this.state.config.searchRange,
            contentType: this.state.config.contentType,
            searchStrategy: this.state.config.searchStrategy,
          });

          this.state.totals.rounds += 1;
          this.state.totals.fetchedCount += result.fetchedCount;
          this.state.totals.normalizedCount += result.normalizedCount;
          this.state.totals.insertedCount += result.insertedCount;
          this.state.totals.modifiedCount += result.modifiedCount;

          if (result.hasMore) {
            this.offsets.set(keyword.id, result.nextOffset);
          } else {
            this.offsets.set(keyword.id, 0);
          }

          this.appendLog(
            "success",
            `Keyword "${keyword.keyword}" fetched ${result.fetchedCount} items, normalized ${result.normalizedCount}, inserted ${result.insertedCount}.`,
            {
              keywordId: keyword.id,
              currentOffset,
              nextOffset: result.nextOffset,
              hasMore: result.hasMore,
            }
          );

          if (!result.hasMore) {
            this.appendLog(
              "info",
              `Keyword "${keyword.keyword}" reached the end of the current result set and will restart from offset 0 in the next round.`,
              { keywordId: keyword.id }
            );
          }
        } catch (error) {
          this.appendLog(
            "error",
            `Keyword "${keyword.keyword}" scan failed: ${error.message}`,
            {
              keywordId: keyword.id,
              offset: currentOffset,
              code: error.code || "",
            }
          );

          if (error.code === "DOUYIN_VERIFY_CHECK") {
            this.appendLog(
              "warning",
              "Continuous discovery stopped because Douyin requested verification. Complete browser verification, then start it again."
            );
            this.finish("verify_check");
            return;
          }
        }

        if (!this.running) {
          break;
        }

        await sleep(this.state.config.requestIntervalMs);
      }

      if (!this.running) {
        break;
      }

      this.appendLog(
        "info",
        `One discovery round finished. Waiting ${Math.round(
          this.state.config.cycleIntervalMs / 1000
        )} seconds before the next round.`
      );
      await sleep(this.state.config.cycleIntervalMs);
    }
  }
}

export const continuousDiscoveryService = new ContinuousDiscoveryService();
