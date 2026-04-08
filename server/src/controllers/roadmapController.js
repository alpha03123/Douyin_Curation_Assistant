import { env } from "../config/env.js";
import { getLegacyBridgeStatus } from "../services/legacy/legacySpiderBridge.js";
import { getRoadmapPayload } from "../services/roadmap/roadmapService.js";

export function getRoadmap(req, res) {
  res.json({
    data: {
      ...getRoadmapPayload(),
      legacyBridge: getLegacyBridgeStatus(env.legacyProjectPath),
    },
  });
}
