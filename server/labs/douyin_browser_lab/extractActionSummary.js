import path from "node:path";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { LAB_CAPTURE_ROOT_DIR } from "./labConfig.js";

const ACTION_PATTERNS = [
  { label: "like", urlPart: "/aweme/v1/web/commit/item/digg/" },
  { label: "collect", urlPart: "/aweme/v1/web/aweme/collect/" },
  { label: "comment", urlPart: "/aweme/v1/web/comment/publish" },
];

function trimText(value = "", limit = 1500) {
  const safeValue = String(value ?? "");
  if (safeValue.length <= limit) {
    return safeValue;
  }

  return `${safeValue.slice(0, limit)}...[truncated]`;
}

function parseArgs(argv) {
  const options = {
    session: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--session" && argv[index + 1]) {
      options.session = argv[index + 1];
      index += 1;
    }
  }

  return options;
}

async function resolveSessionDir(sessionArg = "") {
  if (sessionArg) {
    if (sessionArg.includes("\\") || sessionArg.includes("/")) {
      return path.resolve(sessionArg);
    }

    return path.resolve(LAB_CAPTURE_ROOT_DIR, sessionArg);
  }

  const entries = await readdir(LAB_CAPTURE_ROOT_DIR, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory());
  if (!directories.length) {
    throw new Error("No lab capture sessions were found.");
  }

  const sorted = directories.sort((left, right) =>
    right.name.localeCompare(left.name)
  );
  return path.resolve(LAB_CAPTURE_ROOT_DIR, sorted[0].name);
}

async function loadRecords(sessionDir) {
  const liveFilePath = path.resolve(sessionDir, "live.ndjson");
  const content = await readFile(liveFilePath, "utf8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function parseJsonSafely(value = "") {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function detectActionType(url = "") {
  const loweredUrl = String(url || "").toLowerCase();
  const match = ACTION_PATTERNS.find((item) =>
    loweredUrl.includes(item.urlPart.toLowerCase())
  );
  return match?.label || "";
}

function buildResponseMap(records) {
  const responseMap = new Map();
  for (const record of records) {
    if (record.type !== "response") {
      continue;
    }

    responseMap.set(record.payload?.requestId, record);
  }

  return responseMap;
}

function buildMarkers(records) {
  return records
    .filter((record) => record.type === "manual-marker")
    .map((record) => ({
      seq: record.seq,
      createdAt: record.createdAt,
      label: record.payload?.label || "",
      pageUrl: record.payload?.pageUrl || "",
      key: record.payload?.key || "",
    }));
}

function findBestMarker(markers, requestRecord) {
  const requestSeq = requestRecord.seq;
  const requestPageUrl = requestRecord.payload?.pageUrl || "";
  const actionType = detectActionType(requestRecord.payload?.url);
  const candidates = markers.filter((marker) => {
    if (!marker.label || marker.label !== actionType) {
      return false;
    }

    if (marker.pageUrl && requestPageUrl && marker.pageUrl !== requestPageUrl) {
      return false;
    }

    return marker.seq <= requestSeq && requestSeq - marker.seq <= 80;
  });

  return candidates.at(-1) || null;
}

function buildActionSummaries(records) {
  const responseMap = buildResponseMap(records);
  const markers = buildMarkers(records);

  return records
    .filter((record) => record.type === "request")
    .map((record) => {
      const actionType = detectActionType(record.payload?.url);
      if (!actionType) {
        return null;
      }

      const responseRecord = responseMap.get(record.payload?.requestId);
      const responsePayload = parseJsonSafely(responseRecord?.payload?.responseText || "");
      const marker = findBestMarker(markers, record);

      return {
        actionType,
        requestSeq: record.seq,
        requestAt: record.createdAt,
        requestId: record.payload?.requestId || "",
        marker,
        pageUrl: record.payload?.pageUrl || "",
        requestUrl: record.payload?.url || "",
        requestHeaders: record.payload?.headers || {},
        requestBody: record.payload?.postData || "",
        responseSeq: responseRecord?.seq || null,
        responseAt: responseRecord?.createdAt || "",
        status: responseRecord?.payload?.status || null,
        responseHeaders: responseRecord?.payload?.headers || {},
        responseText: responseRecord?.payload?.responseText || "",
        responseJson: responsePayload,
      };
    })
    .filter(Boolean);
}

function toPrintableSummary(items) {
  return items.map((item) => ({
    actionType: item.actionType,
    markerSeq: item.marker?.seq || null,
    markerLabel: item.marker?.label || "",
    requestSeq: item.requestSeq,
    responseSeq: item.responseSeq,
    status: item.status,
    statusCode:
      item.responseJson?.status_code === undefined
        ? null
        : item.responseJson.status_code,
    requestUrl: item.requestUrl,
    requestBody: trimText(item.requestBody, 220),
    responseText: trimText(item.responseText, 260),
  }));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sessionDir = await resolveSessionDir(options.session);
  const records = await loadRecords(sessionDir);
  const summaries = buildActionSummaries(records);
  const printable = toPrintableSummary(summaries);

  const outputDir = path.resolve(sessionDir);
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.resolve(outputDir, "action-summary.json");
  await writeFile(
    outputPath,
    JSON.stringify(
      {
        sessionDir,
        generatedAt: new Date().toISOString(),
        actionCount: summaries.length,
        items: summaries,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`[lab:summary] sessionDir=${sessionDir}`);
  console.log(`[lab:summary] outputPath=${outputPath}`);
  console.log(JSON.stringify(printable, null, 2));
}

main().catch((error) => {
  console.error("[lab:summary] failed", error);
  process.exit(1);
});
