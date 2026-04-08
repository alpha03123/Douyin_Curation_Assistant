import vm from "node:vm";
import { createHttpError, extractFirstUrlFromText, resolveUrl } from "./sourceApiClient.js";

function normalizePreview(value = "", fallback = "-") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function parseXiaohongshuUrl(url = "") {
  const safeUrl = String(url || "").trim();
  if (!safeUrl) {
    return { type: "unknown", noteId: "", raw: safeUrl };
  }

  let matched = safeUrl.match(/\/discovery\/item\/([a-zA-Z0-9]+)/i);
  if (matched) {
    return {
      type: "note",
      noteId: matched[1],
      raw: safeUrl,
    };
  }

  matched = safeUrl.match(/\/explore\/([a-zA-Z0-9]+)/i);
  if (matched) {
    return {
      type: "note",
      noteId: matched[1],
      raw: safeUrl,
    };
  }

  return {
    type: "unknown",
    noteId: "",
    raw: safeUrl,
  };
}

async function fetchXiaohongshuHtml(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Referer: "https://www.xiaohongshu.com/",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw createHttpError(
      `Xiaohongshu request failed with status ${response.status}.`,
      response.status,
      "XHS_HTTP_ERROR"
    );
  }

  return {
    html: await response.text(),
    finalUrl: String(response.url || url),
  };
}

function extractInitialState(html = "") {
  const marker = "window.__INITIAL_STATE__=";
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) {
    throw createHttpError(
      "Unable to find Xiaohongshu initial state.",
      502,
      "XHS_INITIAL_STATE_MISSING"
    );
  }

  const scriptEndIndex = html.indexOf("</script>", markerIndex);
  if (scriptEndIndex === -1) {
    throw createHttpError(
      "Unable to locate Xiaohongshu initial state boundary.",
      502,
      "XHS_INITIAL_STATE_INVALID"
    );
  }

  let jsonText = html
    .slice(markerIndex + marker.length, scriptEndIndex)
    .trim();

  if (jsonText.endsWith(";")) {
    jsonText = jsonText.slice(0, -1);
  }

  try {
    return JSON.parse(jsonText);
  } catch {
    try {
      return vm.runInNewContext(`(${jsonText})`, Object.create(null), {
        timeout: 1000,
      });
    } catch (error) {
      throw createHttpError(
        error.message || "Unable to parse Xiaohongshu initial state.",
        502,
        "XHS_INITIAL_STATE_PARSE_FAILED"
      );
    }
  }
}

function extractNoteFromState(initialState = {}, noteId = "") {
  const noteMap = initialState?.note?.noteDetailMap || {};
  if (noteId && noteMap[noteId]?.note) {
    return noteMap[noteId].note;
  }

  const firstItem = Object.values(noteMap).find((item) => item?.note);
  return firstItem?.note || null;
}

function pickFirstAvailableImageUrl(image = {}) {
  return (
    image?.urlDefault ||
    image?.urlPre ||
    image?.url ||
    image?.infoList?.[0]?.url ||
    ""
  );
}

function pickBestVideoUrl(note = {}) {
  const streams = note?.video?.media?.stream?.h264 || [];
  const sortedStreams = [...streams].sort(
    (left, right) => Number(right?.videoBitrate || 0) - Number(left?.videoBitrate || 0)
  );
  return sortedStreams[0]?.masterUrl || "";
}

export async function resolveXiaohongshuSource(sourceText = "") {
  const extracted = extractFirstUrlFromText(sourceText);
  const resolvedUrl = await resolveUrl(extracted || sourceText);
  const parsed = parseXiaohongshuUrl(resolvedUrl);

  if (parsed.type === "unknown" || !parsed.noteId) {
    throw createHttpError(
      "Unsupported Xiaohongshu URL.",
      400,
      "XHS_UNSUPPORTED_URL"
    );
  }

  const { html, finalUrl } = await fetchXiaohongshuHtml(resolvedUrl);
  const initialState = extractInitialState(html);
  const note = extractNoteFromState(initialState, parsed.noteId);

  if (!note) {
    throw createHttpError(
      "Unable to locate Xiaohongshu note data.",
      404,
      "XHS_NOTE_NOT_FOUND"
    );
  }

  const isVideo = String(note.type || "").toLowerCase() === "video";
  const imageUrls = (Array.isArray(note.imageList) ? note.imageList : [])
    .map((item) => pickFirstAvailableImageUrl(item))
    .filter(Boolean);
  const coverUrl = imageUrls[0] || "";
  const videoUrl = isVideo ? pickBestVideoUrl(note) : "";

  return {
    platform: "xiaohongshu",
    sourceType: "url",
    parsedType: isVideo ? "video" : "gallery",
    sourceId: parsed.noteId,
    normalizedUrl: finalUrl,
    title: normalizePreview(note.title, parsed.noteId),
    authorName: normalizePreview(note.user?.nickname, "unknown-author"),
    itemCount: isVideo ? 1 : Math.max(1, imageUrls.length),
    supportedAssets: isVideo ? ["video", "cover", "metadata"] : ["images", "metadata"],
    options: {
      removeWatermark: false,
    },
    detail: {
      noteId: parsed.noteId,
      note,
      imageUrls,
      coverUrl,
      videoUrl,
    },
  };
}
