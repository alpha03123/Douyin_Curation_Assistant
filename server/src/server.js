import { createApp } from "./app.js";
import { connectDatabase } from "./config/db.js";
import { env } from "./config/env.js";

async function bootstrap() {
  try {
    await connectDatabase();
  } catch (error) {
    error.message = `SQLite initialization failed: ${env.sqlitePath}. Check SQLITE_PATH or filesystem permissions. Original error: ${error.message}`;
    throw error;
  }

  const app = createApp();
  await new Promise((resolve, reject) => {
    const server = app.listen(env.port, () => {
      console.log(
        `[server] listening on http://localhost:${env.port} and connected to SQLite: ${env.sqlitePath}`
      );
      resolve();
    });

    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        error.message = `Port ${env.port} is already in use. Stop the old backend process or run ./stop_dev.ps1 before retrying.`;
      }
      reject(error);
    });
  });
}

bootstrap().catch((error) => {
  console.error("[server] failed to start", error);
  process.exit(1);
});
