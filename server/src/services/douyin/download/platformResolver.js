export function detectPlatformFromUrl(url = "") {
  const safeUrl = String(url || "").trim();
  if (!safeUrl) {
    return "unknown";
  }

  let host = "";
  try {
    host = new URL(safeUrl).host.toLowerCase();
  } catch {
    return "unknown";
  }

  if (host.includes("douyin.com")) {
    return "douyin";
  }

  if (host.includes("xiaohongshu.com") || host.includes("xhslink.com")) {
    return "xiaohongshu";
  }

  if (host.includes("bilibili.com") || host.includes("b23.tv")) {
    return "bilibili";
  }

  if (host.includes("instagram.com")) {
    return "instagram";
  }

  if (host.includes("tiktok.com")) {
    return "tiktok";
  }

  if (host === "x.com" || host.endsWith(".x.com") || host.includes("twitter.com")) {
    return "x";
  }

  return "unknown";
}
