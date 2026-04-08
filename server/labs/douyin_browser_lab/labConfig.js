import path from "node:path";
import { env } from "../../src/config/env.js";

export const LAB_PROFILE_DIR = path.resolve(
  env.projectRoot,
  ".runtime",
  "lab-browser-profile"
);

export const LAB_CAPTURE_ROOT_DIR = path.resolve(
  env.projectRoot,
  ".runtime",
  "lab-captures"
);

export const LAB_RUN_ROOT_DIR = path.resolve(
  env.projectRoot,
  ".runtime",
  "lab-runs"
);

export const LAB_DEFAULT_TARGET_URL =
  env.actionCaptureTargetUrl || "https://www.douyin.com/";

export const HOTKEY_HINTS = [
  "Ctrl+Shift+1 => mark like",
  "Ctrl+Shift+2 => mark collect",
  "Ctrl+Shift+3 => mark comment",
  "Ctrl+Shift+4 => mark note",
];
