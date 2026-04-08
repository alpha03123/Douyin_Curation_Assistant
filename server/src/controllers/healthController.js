import { getDatabaseStatus } from "../config/db.js";
import { env } from "../config/env.js";

export function getHealth(req, res) {
  const database = getDatabaseStatus();

  res.json({
    ok: database.label === "connected",
    service: "douyin-curation-assistant-server",
    timestamp: new Date().toISOString(),
    database,
    clientOrigin: env.clientOrigin,
    clientOrigins: env.clientOrigins,
  });
}
