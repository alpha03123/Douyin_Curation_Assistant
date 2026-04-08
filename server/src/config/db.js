import { env } from "./env.js";
import {
  connectSqliteDatabase,
  getSqliteStatus,
} from "../storage/sqlite.js";

export async function connectDatabase() {
  connectSqliteDatabase(env.sqlitePath);
}

export function getDatabaseStatus() {
  return getSqliteStatus();
}
