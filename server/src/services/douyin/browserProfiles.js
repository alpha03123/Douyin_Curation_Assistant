import path from "node:path";
import { env } from "../../config/env.js";

export const BROWSER_PROFILE_DIR = path.resolve(
  env.projectRoot,
  ".runtime",
  "browser-profile"
);

export const RECOMMEND_PROFILE_DIR = path.resolve(
  env.projectRoot,
  ".runtime",
  "recommend-browser-profile"
);

export const LAB_PROFILE_DIR = path.resolve(
  env.projectRoot,
  ".runtime",
  "lab-browser-profile"
);
