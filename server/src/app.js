import cors from "cors";
import express from "express";
import morgan from "morgan";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middlewares/errorHandler.js";
import { createMcpHttpRouter } from "./mcp/httpRouter.js";
import apiRouter from "./routes/index.js";

export function createApp() {
  const app = express();
  const allowedOrigins = new Set(env.clientOrigins || []);

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.has("*") || allowedOrigins.has(origin)) {
          callback(null, true);
          return;
        }

        callback(null, false);
      },
      credentials: true,
    })
  );
  app.use(express.json());
  app.use(morgan("dev"));

  app.get("/", (req, res) => {
    res.json({
      service: "douyin-curation-assistant-server",
      docs: "/api/v1/roadmap",
    });
  });

  app.use("/api/v1", apiRouter);
  app.use("/mcp", createMcpHttpRouter());
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
