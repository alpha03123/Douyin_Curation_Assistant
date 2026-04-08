export function parseDouyinUrl(url = "") {
  const safeUrl = String(url || "").trim();

  if (!safeUrl) {
    return {
      type: "unknown",
      raw: safeUrl,
      id: "",
    };
  }

  let matched = safeUrl.match(/\/video\/(\d+)/i);
  if (matched) {
    return {
      type: "video",
      raw: safeUrl,
      id: matched[1],
    };
  }

  matched = safeUrl.match(/\/(?:note|gallery|slides)\/(\d+)/i);
  if (matched) {
    return {
      type: "gallery",
      raw: safeUrl,
      id: matched[1],
    };
  }

  matched = safeUrl.match(/\/(?:collection|mix)\/(\d+)/i);
  if (matched) {
    return {
      type: "collection",
      raw: safeUrl,
      id: matched[1],
    };
  }

  matched = safeUrl.match(/\/music\/(\d+)/i);
  if (matched) {
    return {
      type: "music",
      raw: safeUrl,
      id: matched[1],
    };
  }

  if (/^https:\/\/v\.douyin\.com\//i.test(safeUrl)) {
    return {
      type: "short",
      raw: safeUrl,
      id: "",
    };
  }

  return {
    type: "unknown",
    raw: safeUrl,
    id: "",
  };
}
