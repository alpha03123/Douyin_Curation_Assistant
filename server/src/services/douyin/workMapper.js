function pickFirstUrl(value) {
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

  if (value && typeof value === "object") {
    const preferredKeys = [
      "url_list",
      "src",
      "url",
      "download_url_list",
      "origin_url_list",
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

function normalizeImageUrls(images) {
  if (!Array.isArray(images)) {
    return [];
  }

  return images
    .map((image) => pickFirstUrl(image))
    .filter((imageUrl) => Boolean(imageUrl));
}

function normalizeTopics(textExtra) {
  if (!Array.isArray(textExtra)) {
    return [];
  }

  return textExtra
    .map((item) => item?.hashtag_name || "")
    .filter((topic) => Boolean(topic));
}

function normalizeGender(gender) {
  if (gender === 0) {
    return "female";
  }

  if (gender === 1) {
    return "male";
  }

  return "unknown";
}

function normalizeWorkType(awemeType) {
  if (awemeType === 68) {
    return "image";
  }

  if (awemeType === 0) {
    return "video";
  }

  return "unknown";
}

function mapAwemeDataToWorkDocument(data, options = {}) {
  if (!data?.aweme_id || !data?.author) {
    return null;
  }

  const {
    discoverySource = "keyword",
    sourceLabel = "",
    keywordSource = "",
    rawJson = {},
  } = options;
  const author = data.author || {};
  const user = data.user || {};
  const statistics = data.statistics || {};
  const secUid = author.sec_uid || "";
  const workType = normalizeWorkType(data.aweme_type);
  const musicAddr =
    pickFirstUrl(data?.music?.play_url || {}) ||
    pickFirstUrl(data?.music?.play_url_lowbr || {}) ||
    "";

  return {
    awemeId: String(data.aweme_id),
    workUrl:
      workType === "image"
        ? `https://www.douyin.com/note/${data.aweme_id}`
        : `https://www.douyin.com/video/${data.aweme_id}`,
    workType,
    discoverySource,
    sourceLabel: sourceLabel || "",
    title: data.desc || "",
    desc: data.desc || "",
    authorName: author.nickname || "",
    authorAvatar: pickFirstUrl(author.avatar_thumb || {}),
    userUrl: secUid ? `https://www.douyin.com/user/${secUid}` : "",
    userId: author.unique_id || "",
    authorSecUid: secUid,
    userDesc: author.signature || "",
    keywordSource,
    topics: normalizeTopics(data.text_extra || []),
    images: normalizeImageUrls(data.images || []),
    videoCover: pickFirstUrl(data.video?.cover || {}),
    videoAddr: pickFirstUrl(data.video?.play_addr || {}) || musicAddr,
    musicAddr,
    admireCount: Number(statistics.admire_count || 0),
    diggCount: Number(statistics.digg_count || 0),
    commentCount: Number(statistics.comment_count || 0),
    collectCount: Number(statistics.collect_count || 0),
    shareCount: Number(statistics.share_count || 0),
    authorUid: String(author.uid || ""),
    followingCount: Number(author.following_count || 0),
    followerCount: Number(author.follower_count || 0),
    totalFavorited: Number(author.total_favorited || 0),
    awemeCount: Number(author.aweme_count || 0),
    publishAt: data.create_time ? new Date(Number(data.create_time) * 1000) : null,
    userAge:
      author.user_age === undefined || author.user_age === null
        ? null
        : Number(author.user_age),
    gender: normalizeGender(author.gender),
    ipLocation: user.ip_location || "",
    authorShortId: String(author.short_id || ""),
    authorCustomVerify: String(author.custom_verify || ""),
    authorEnterpriseVerifyReason: String(author.enterprise_verify_reason || ""),
    authorVerificationType: Number(author.verification_type || 0),
    country: String(author.country || ""),
    province: String(author.province || ""),
    city: String(author.city || ""),
    district: String(author.district || ""),
    rawJson,
  };
}

export function mapSearchItemToWorkDocument(item, keywordSource) {
  return mapAwemeDataToWorkDocument(item?.aweme_info, {
    discoverySource: "keyword",
    sourceLabel: keywordSource || "",
    keywordSource,
    rawJson: item,
  });
}

export function mapAwemeDetailToWorkDocument(detail, options = {}) {
  return mapAwemeDataToWorkDocument(detail, {
    discoverySource: options.discoverySource || "recommend",
    sourceLabel: options.sourceLabel || "recommend",
    keywordSource: options.keywordSource || "",
    rawJson: options.rawJson || {
      aweme_info: detail,
    },
  });
}

export function buildWorkUpsertOperation(workDocument) {
  const now = new Date();

  return {
    updateOne: {
      filter: { awemeId: workDocument.awemeId },
      update: {
        $set: {
          ...workDocument,
          lastCollectedAt: now,
        },
        $setOnInsert: {
          status: "new",
          discoveredAt: now,
        },
      },
      upsert: true,
    },
  };
}
