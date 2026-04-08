import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { env } from "../config/env.js";

let sqliteDb = null;
let sqliteStatus = {
  readyState: 0,
  label: "disconnected",
  name: "",
  host: "",
  filePath: "",
};

function ensureParentDir(filePath) {
  const directory = path.dirname(filePath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

function applyPragmas(db) {
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
}

export function connectSqliteDatabase(filePath = env.sqlitePath) {
  if (sqliteDb) {
    return sqliteDb;
  }

  ensureParentDir(filePath);

  const db = new Database(filePath);
  applyPragmas(db);

  sqliteDb = db;
  sqliteStatus = {
    readyState: 1,
    label: "connected",
    name: path.basename(filePath),
    host: path.dirname(filePath),
    filePath,
  };

  return sqliteDb;
}

export function getSqliteDatabase() {
  if (!sqliteDb) {
    return connectSqliteDatabase(env.sqlitePath);
  }

  return sqliteDb;
}

export function getSqliteStatus() {
  return { ...sqliteStatus };
}

export function closeSqliteDatabase() {
  if (!sqliteDb) {
    return;
  }

  sqliteDb.close();
  sqliteDb = null;
  sqliteStatus = {
    readyState: 0,
    label: "disconnected",
    name: "",
    host: "",
    filePath: env.sqlitePath,
  };
}
