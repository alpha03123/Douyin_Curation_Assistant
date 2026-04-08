import { getAwemeDetail, buildCanonicalWorkUrl } from "./detailResolver.js";
import { detectPlatformFromUrl } from "./platformResolver.js";
import { resolveDownloadAssets } from "./mediaResolver.js";
import { parseDouyinUrl } from "./urlParser.js";
import { resolveXiaohongshuSource } from "./xiaohongshuResolver.js";
import {
  createHttpError,
  getMixAwemePage,
  getMixDetail,
  getMusicAwemePage,
  getMusicDetail,
  resolveUrl,
} from "./sourceApiClient.js";
import { resolveWithYtDlp } from "./ytDlpService.js";

function normalizePreview(value = "", fallback = "-") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function buildWorkPreview(detail = {}, normalizedUrl = "") {
  const parsedType = detail?.image_post_info || detail?.images?.length ? "gallery" : "video";
  const assets = resolveDownloadAssets(detail, {
    assets:
      parsedType === "gallery"
        ? ["images", "cover", "music", "metadata"]
        : ["video", "cover", "music", "metadata"],
    removeWatermark: true,
    referer: normalizedUrl,
  });

  return {
    sourceType: "url",
    parsedType: assets.parsedType || parsedType,
    sourceId: String(detail?.aweme_id || ""),
    normalizedUrl,
    title: normalizePreview(detail?.desc, detail?.aweme_id),
    authorName: normalizePreview(detail?.author?.nickname, "unknown-author"),
    itemCount: 1,
    supportedAssets:
      parsedType === "gallery"
        ? ["images", "cover", "music", "metadata"]
        : ["video", "cover", "music", "metadata"],
    options: {
      removeWatermark: parsedType !== "gallery",
    },
  };
}

export async function resolveDownloadSource(sourceUrl = "") {
  const normalizedUrl = await resolveUrl(sourceUrl);
  const platform = detectPlatformFromUrl(normalizedUrl);

  if (platform === "xiaohongshu") {
    return resolveXiaohongshuSource(normalizedUrl);
  }

  if (["bilibili", "instagram", "tiktok", "x"].includes(platform)) {
    return resolveWithYtDlp(normalizedUrl);
  }

  const parsed = parseDouyinUrl(normalizedUrl);

  if (parsed.type === "unknown" || !parsed.id) {
    throw createHttpError(
      "Unsupported URL. Please provide a supported Bilibili, Douyin, Xiaohongshu, Instagram, TikTok, or X link.",
      400,
      "DOWNLOAD_UNSUPPORTED_URL"
    );
  }

  if (parsed.type === "video" || parsed.type === "gallery") {
    const detail = await getAwemeDetail(parsed.id, normalizedUrl);
    return buildWorkPreview(detail, buildCanonicalWorkUrl({
      awemeId: parsed.id,
      workType: parsed.type === "gallery" ? "image" : "video",
      workUrl: normalizedUrl,
    }));
  }

  if (parsed.type === "collection") {
    const detail = await getMixDetail(parsed.id, normalizedUrl);
    const firstPage = await getMixAwemePage(parsed.id, 0, 6, normalizedUrl);
    return {
      sourceType: "url",
      parsedType: "collection",
      sourceId: parsed.id,
      normalizedUrl,
      title: normalizePreview(detail?.mix_name || detail?.desc, parsed.id),
      authorName: normalizePreview(detail?.author?.nickname, "unknown-author"),
      itemCount:
        Number(detail?.mix_aweme_count || detail?.aweme_count || firstPage.items.length || 0),
      supportedAssets: ["video", "images", "cover", "music", "metadata"],
      options: {
        removeWatermark: true,
      },
    };
  }

  if (parsed.type === "music") {
    const detail = await getMusicDetail(parsed.id, normalizedUrl);
    return {
      sourceType: "url",
      parsedType: "music",
      sourceId: parsed.id,
      normalizedUrl,
      title: normalizePreview(detail?.title || detail?.music_name, parsed.id),
      authorName: normalizePreview(
        detail?.owner?.nickname || detail?.author_name,
        "unknown-author"
      ),
      itemCount: 1,
      supportedAssets: ["music", "cover", "metadata"],
      options: {
        removeWatermark: false,
      },
    };
  }

  throw createHttpError("Unsupported download source type.", 400, "DOWNLOAD_UNSUPPORTED_TYPE");
}

export async function resolveMusicFallbackAweme(musicId, normalizedUrl = "") {
  const page = await getMusicAwemePage(musicId, 0, 1, normalizedUrl || `https://www.douyin.com/music/${musicId}`);
  const firstItem = page.items[0] || null;
  if (!firstItem?.aweme_id) {
    return null;
  }

  return firstItem;
}
