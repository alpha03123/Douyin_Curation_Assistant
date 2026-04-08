import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const douyinRuntime = require("../../vendors/douyin/dy_ab.cjs");

export function spliceUrl(params) {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value ?? "")}`)
    .join("&");
}

export function generateABogus(queryString, dataString = "") {
  return douyinRuntime.get_ab(queryString, dataString);
}
