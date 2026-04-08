import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { buildDocumentHeaders } from "./headers.js";

const MS_TOKEN_CHARS =
  "ABCDEFGHIGKLMNOPQRSTUVWXYZabcdefghigklmnopqrstuvwxyz0123456789=";
const WEB_ID_CHARS = "0123456789";
const WEB_ID_REGEX = /\\"user_unique_id\\":\\"(.*?)\\"/;

function randomFromCharset(charset, length) {
  let output = "";

  for (let index = 0; index < length; index += 1) {
    output += charset[crypto.randomInt(0, charset.length)];
  }

  return output;
}

export function parseCookieString(cookieString = "") {
  const cookies = {};

  for (const item of cookieString.split(/;\s*/)) {
    if (!item) {
      continue;
    }

    const delimiterIndex = item.indexOf("=");
    if (delimiterIndex === -1) {
      continue;
    }

    const key = item.slice(0, delimiterIndex).trim();
    const value = item.slice(delimiterIndex + 1).trim();

    if (key) {
      cookies[key] = value;
    }
  }

  return cookies;
}

export function serializeCookies(cookies = {}) {
  return Object.entries(cookies)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

export function generateMsToken(length = 107) {
  return randomFromCharset(MS_TOKEN_CHARS, length);
}

export function generateFakeWebId(length = 19) {
  return randomFromCharset(WEB_ID_CHARS, length);
}

export function ensureDouyinAuth(cookieString = "") {
  const cookie = parseCookieString(cookieString);
  const verifyFp =
    cookie.s_v_web_id || cookie.verifyFp || cookie.fp || generateFakeWebId();
  const msToken = cookie.msToken || generateMsToken();

  cookie.s_v_web_id = verifyFp;
  cookie.verifyFp = verifyFp;
  cookie.fp = verifyFp;
  cookie.msToken = msToken;

  return {
    cookie,
    verifyFp,
    msToken,
    cookieString: serializeCookies(cookie),
  };
}

export function getSharedDouyinCookieString() {
  if (!env.dyCookies) {
    const error = new Error(
      "DY_COOKIES is missing. Add it to Douyin_Curation_Assistant/.env first."
    );
    error.statusCode = 500;
    error.code = "DY_COOKIES_MISSING";
    throw error;
  }

  return env.dyCookies;
}

export function getSharedDouyinAuth() {
  return ensureDouyinAuth(getSharedDouyinCookieString());
}

export async function generateWebId(auth, url) {
  try {
    const response = await fetch(url, {
      headers: buildDocumentHeaders(auth.cookieString),
      redirect: "follow",
    });
    const html = await response.text();
    const matched = html.match(WEB_ID_REGEX);

    return matched?.[1] || generateFakeWebId();
  } catch {
    return generateFakeWebId();
  }
}
