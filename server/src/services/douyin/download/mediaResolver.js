import { DEFAULT_USER_AGENT } from "../headers.js";

function pickFirstUrl(value) {
  if (!value) {
    return "";
  }

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

  if (typeof value === "object") {
    const preferredKeys = [
      "url_list",
      "download_url_list",
      "origin_url_list",
      "play_addr",
      "download_addr",
      "play_url",
      "url",
      "src",
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

function collectImageUrls(detail = {}) {
  const images = detail?.image_post_info?.images || detail?.images || [];
  const results = [];

  for (const item of images) {
    const url =
      pickFirstUrl(item?.download_url) ||
      pickFirstUrl(item?.download_addr) ||
      pickFirstUrl(item?.owner_watermark_image) ||
      pickFirstUrl(item?.display_image) ||
      pickFirstUrl(item);

    if (url) {
      results.push(url);
    }
  }

  return [...new Set(results)];
}

function detectParsedType(detail = {}) {
  if (collectImageUrls(detail).length > 0) {
    return "gallery";
  }

  if (detail?.video || detail?.aweme_type === 0) {
    return "video";
  }

  return "unknown";
}

function buildDownloadHeaders(referer) {
  return {
    Referer: referer,
    Origin: "https://www.douyin.com",
    Accept: "*/*",
    "User-Agent": DEFAULT_USER_AGENT,
  };
}

function resolveVideoUrl(detail = {}, removeWatermark = true) {
  const playAddr = detail?.video?.play_addr;
  const downloadAddr = detail?.video?.download_addr;
  const candidates = [
    ...(Array.isArray(playAddr?.url_list) ? playAddr.url_list : []),
    ...(Array.isArray(downloadAddr?.url_list) ? downloadAddr.url_list : []),
  ].filter(Boolean);

  if (removeWatermark) {
    const noWatermarkCandidate = candidates.find((item) =>
      String(item).includes("watermark=0")
    );
    if (noWatermarkCandidate) {
      return noWatermarkCandidate;
    }
  }

  return candidates[0] || "";
}

function resolveCoverUrl(detail = {}) {
  return (
    pickFirstUrl(detail?.video?.cover) ||
    pickFirstUrl(detail?.video?.origin_cover) ||
    collectImageUrls(detail)[0] ||
    ""
  );
}

function resolveMusicUrl(detail = {}) {
  return (
    pickFirstUrl(detail?.music?.play_url) ||
    pickFirstUrl(detail?.music?.play_url_lowbr) ||
    pickFirstUrl(detail?.music?.audio_url) ||
    ""
  );
}

export function resolveDownloadAssets(detail, options = {}) {
  const referer = String(options.referer || "https://www.douyin.com/").trim();
  const parsedType = detectParsedType(detail);
  const requestedAssets = new Set(options.assets || []);
  const assets = [];

  if (requestedAssets.has("video") && parsedType === "video") {
    const url = resolveVideoUrl(detail, options.removeWatermark !== false);
    if (url) {
      assets.push({
        assetType: "video",
        sourceUrl: url,
        headers: buildDownloadHeaders(referer),
      });
    }
  }

  if (requestedAssets.has("images") && parsedType === "gallery") {
    const imageUrls = collectImageUrls(detail);
    imageUrls.forEach((url, index) => {
      assets.push({
        assetType: "image",
        sourceUrl: url,
        sequence: index + 1,
        headers: buildDownloadHeaders(referer),
      });
    });
  }

  if (requestedAssets.has("cover")) {
    const url = resolveCoverUrl(detail);
    if (url) {
      assets.push({
        assetType: "cover",
        sourceUrl: url,
        headers: buildDownloadHeaders(referer),
      });
    }
  }

  if (requestedAssets.has("music")) {
    const url = resolveMusicUrl(detail);
    if (url) {
      assets.push({
        assetType: "music",
        sourceUrl: url,
        headers: buildDownloadHeaders(referer),
      });
    }
  }

  if (requestedAssets.has("metadata")) {
    assets.push({
      assetType: "metadata",
      sourceUrl: "",
      headers: {},
    });
  }

  return {
    parsedType,
    assets,
  };
}
