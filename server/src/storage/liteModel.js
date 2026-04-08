import crypto from "node:crypto";
import { getSqliteDatabase } from "./sqlite.js";

const modelRegistry = new Map();
const tableReady = new Set();

function nowIsoString() {
  return new Date().toISOString();
}

function deepClone(value) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stripFunctions(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stripFunctions(item));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const result = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (typeof nestedValue === "function") {
      continue;
    }
    result[key] = stripFunctions(nestedValue);
  }

  return result;
}

function mergeDefaults(defaults, input) {
  const base = deepClone(defaults || {});
  const source = deepClone(input || {});

  function assign(target, payload) {
    for (const [key, value] of Object.entries(payload || {})) {
      if (Array.isArray(value)) {
        target[key] = deepClone(value);
        continue;
      }

      if (isPlainObject(value)) {
        const targetValue = isPlainObject(target[key]) ? target[key] : {};
        target[key] = assign(targetValue, value);
        continue;
      }

      target[key] = value;
    }

    return target;
  }

  return assign(base, source);
}

function getByPath(target, path) {
  if (!path) {
    return target;
  }

  const parts = String(path).split(".");
  let cursor = target;

  for (const part of parts) {
    if (cursor === null || cursor === undefined) {
      return undefined;
    }

    cursor = cursor[part];
  }

  return cursor;
}

function setByPath(target, path, value) {
  const parts = String(path).split(".");
  let cursor = target;

  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    if (!isPlainObject(cursor[key])) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }

  cursor[parts[parts.length - 1]] = value;
}

function removeGlobalFlag(flags = "") {
  return String(flags || "").replace(/g/g, "");
}

function testRegex(regex, value) {
  const safeRegex = new RegExp(regex.source, removeGlobalFlag(regex.flags));
  return safeRegex.test(String(value ?? ""));
}

function matchesInCondition(docValue, list) {
  if (!Array.isArray(list)) {
    return false;
  }

  if (Array.isArray(docValue)) {
    return docValue.some((item) => list.includes(item));
  }

  return list.includes(docValue);
}

function isOperatorObject(value) {
  return (
    isPlainObject(value) &&
    Object.keys(value).some((key) => key.startsWith("$"))
  );
}

function matchesCondition(docValue, condition) {
  if (condition instanceof RegExp) {
    if (Array.isArray(docValue)) {
      return docValue.some((item) => testRegex(condition, item));
    }

    return testRegex(condition, docValue);
  }

  if (isOperatorObject(condition)) {
    if ("$in" in condition && !matchesInCondition(docValue, condition.$in)) {
      return false;
    }

    if ("$gte" in condition && compareValues(docValue, condition.$gte) < 0) {
      return false;
    }

    if ("$gt" in condition && compareValues(docValue, condition.$gt) <= 0) {
      return false;
    }

    if ("$lte" in condition && compareValues(docValue, condition.$lte) > 0) {
      return false;
    }

    if ("$lt" in condition && compareValues(docValue, condition.$lt) >= 0) {
      return false;
    }

    return true;
  }

  if (Array.isArray(docValue)) {
    return docValue.includes(condition);
  }

  return docValue === condition;
}

function matchesFilter(document, filter = {}) {
  if (!filter || Object.keys(filter).length === 0) {
    return true;
  }

  for (const [key, condition] of Object.entries(filter)) {
    if (key === "$or") {
      if (!Array.isArray(condition) || condition.length === 0) {
        return false;
      }

      if (!condition.some((item) => matchesFilter(document, item))) {
        return false;
      }

      continue;
    }

    const docValue = getByPath(document, key);
    if (!matchesCondition(docValue, condition)) {
      return false;
    }
  }

  return true;
}

function compareValues(leftValue, rightValue) {
  if (leftValue === rightValue) {
    return 0;
  }

  if (leftValue === undefined || leftValue === null) {
    return 1;
  }

  if (rightValue === undefined || rightValue === null) {
    return -1;
  }

  if (typeof leftValue === "number" && typeof rightValue === "number") {
    return leftValue - rightValue;
  }

  if (typeof leftValue === "boolean" && typeof rightValue === "boolean") {
    return Number(leftValue) - Number(rightValue);
  }

  return String(leftValue).localeCompare(String(rightValue));
}

function applySort(documents, sortConfig = {}) {
  const entries = Object.entries(sortConfig || {});
  if (entries.length === 0) {
    return documents;
  }

  const sorted = [...documents];
  sorted.sort((left, right) => {
    for (const [field, directionValue] of entries) {
      const direction = Number(directionValue) >= 0 ? 1 : -1;
      const leftValue = getByPath(left, field);
      const rightValue = getByPath(right, field);
      const result = compareValues(leftValue, rightValue);
      if (result !== 0) {
        return result * direction;
      }
    }

    return 0;
  });

  return sorted;
}

function extractInsertCandidateFromFilter(filter = {}) {
  const candidate = {};
  for (const [key, value] of Object.entries(filter || {})) {
    if (key.startsWith("$")) {
      continue;
    }

    if (isOperatorObject(value)) {
      continue;
    }

    setByPath(candidate, key, deepClone(value));
  }

  return candidate;
}

function applyUpdateToDocument(document, update, isInsert = false) {
  const nextDocument = deepClone(document || {});

  if (isPlainObject(update) && ("$set" in update || "$setOnInsert" in update)) {
    if (isInsert && isPlainObject(update.$setOnInsert)) {
      for (const [key, value] of Object.entries(update.$setOnInsert)) {
        if (key.includes(".")) {
          setByPath(nextDocument, key, deepClone(value));
        } else {
          nextDocument[key] = deepClone(value);
        }
      }
    }

    if (isPlainObject(update.$set)) {
      for (const [key, value] of Object.entries(update.$set)) {
        if (key.includes(".")) {
          setByPath(nextDocument, key, deepClone(value));
        } else {
          nextDocument[key] = deepClone(value);
        }
      }
    }

    return nextDocument;
  }

  if (isPlainObject(update)) {
    for (const [key, value] of Object.entries(update)) {
      nextDocument[key] = deepClone(value);
    }
  }

  return nextDocument;
}

class LiteQuery {
  constructor(model, options = {}) {
    this.model = model;
    this.filter = deepClone(options.filter || {});
    this.single = Boolean(options.single);
    this.sortConfig = null;
    this.limitValue = null;
    this.populatePaths = [];
    this.preloadedDocs =
      options.preloadedDocs === undefined
        ? null
        : deepClone(Array.isArray(options.preloadedDocs) ? options.preloadedDocs : []);
  }

  sort(config = {}) {
    this.sortConfig = deepClone(config || {});
    return this;
  }

  limit(value) {
    const parsed = Number(value);
    this.limitValue = Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : null;
    return this;
  }

  populate(path) {
    if (path) {
      this.populatePaths.push(String(path));
    }

    return this;
  }

  or(conditions = []) {
    const existingFilter = deepClone(this.filter || {});
    const nextOr = Array.isArray(conditions) ? deepClone(conditions) : [];
    if (nextOr.length === 0) {
      return this;
    }

    this.filter = {
      ...existingFilter,
      $or: nextOr,
    };

    return this;
  }

  exec() {
    let documents = this.preloadedDocs
      ? deepClone(this.preloadedDocs)
      : this.model._findSync(this.filter);

    if (!this.preloadedDocs) {
      if (this.sortConfig) {
        documents = applySort(documents, this.sortConfig);
      }

      if (this.limitValue !== null) {
        documents = documents.slice(0, this.limitValue);
      }
    }

    if (this.populatePaths.length > 0) {
      documents = this.model._populateDocuments(documents, this.populatePaths);
    }

    const wrapped = documents.map((item) => this.model._wrapDocument(item));

    if (this.single) {
      return wrapped[0] || null;
    }

    return wrapped;
  }

  then(onFulfilled, onRejected) {
    return Promise.resolve(this.exec()).then(onFulfilled, onRejected);
  }

  catch(onRejected) {
    return this.then(undefined, onRejected);
  }

  finally(onFinally) {
    return this.then(
      (value) => Promise.resolve(onFinally?.()).then(() => value),
      (error) =>
        Promise.resolve(onFinally?.()).then(() => {
          throw error;
        })
    );
  }
}

function createDuplicateError(message) {
  const error = new Error(message);
  error.code = 11000;
  return error;
}

function normalizeValueForUnique(value) {
  if (value === undefined || value === null) {
    return "";
  }

  if (Array.isArray(value) || isPlainObject(value)) {
    return JSON.stringify(value);
  }

  return String(value);
}

function normalizeId(value) {
  if (value === undefined || value === null || value === "") {
    return "";
  }

  return String(value);
}

function normalizeIdList(values = []) {
  const normalized = [];
  const seen = new Set();

  for (const value of Array.isArray(values) ? values : []) {
    const id = normalizeId(value);
    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    normalized.push(id);
  }

  return normalized;
}

function ensureTable(tableName) {
  if (tableReady.has(tableName)) {
    return;
  }

  const db = getSqliteDatabase();
  db.prepare(
    `CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )`
  ).run();
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_${tableName}_updatedAt ON ${tableName}(updatedAt)`
  ).run();
  tableReady.add(tableName);
}

function createId() {
  return crypto.randomUUID();
}

function buildModel(config = {}) {
  const {
    modelName,
    tableName,
    defaults = {},
    uniqueFields = [],
    populate = {},
  } = config;

  if (!modelName || !tableName) {
    throw new Error("modelName and tableName are required for a lite model.");
  }

  const model = {
    modelName,
    tableName,
    defaults,
    uniqueFields,
    populate,

    _ensureTable() {
      ensureTable(tableName);
    },

    _loadRawRows() {
      this._ensureTable();
      const db = getSqliteDatabase();
      const rows = db.prepare(`SELECT id, json, createdAt, updatedAt FROM ${tableName}`).all();
      return rows;
    },

    _loadRawRowById(id) {
      const safeId = normalizeId(id);
      if (!safeId) {
        return null;
      }

      this._ensureTable();
      const db = getSqliteDatabase();
      return (
        db
          .prepare(`SELECT id, json, createdAt, updatedAt FROM ${tableName} WHERE id = ?`)
          .get(safeId) || null
      );
    },

    _loadRawRowsByIds(ids = []) {
      const normalizedIds = normalizeIdList(ids);
      if (normalizedIds.length === 0) {
        return [];
      }

      this._ensureTable();
      const db = getSqliteDatabase();
      const placeholders = normalizedIds.map(() => "?").join(", ");
      const rows = db
        .prepare(
          `SELECT id, json, createdAt, updatedAt FROM ${tableName} WHERE id IN (${placeholders})`
        )
        .all(...normalizedIds);
      const rowMap = new Map(rows.map((row) => [String(row.id), row]));

      return normalizedIds.map((id) => rowMap.get(id)).filter(Boolean);
    },

    _decodeRow(row) {
      const payload = row?.json ? JSON.parse(row.json) : {};
      const normalized = {
        ...payload,
        _id: payload._id || row.id,
        createdAt: payload.createdAt || row.createdAt,
        updatedAt: payload.updatedAt || row.updatedAt,
      };
      return normalized;
    },

    _encodeDocument(document) {
      const clean = stripFunctions(document || {});
      return JSON.stringify(clean);
    },

    _writeDocument(document) {
      this._ensureTable();
      const db = getSqliteDatabase();
      const payload = this._encodeDocument(document);
      db.prepare(
        `INSERT OR REPLACE INTO ${tableName} (id, json, createdAt, updatedAt)
         VALUES (@id, @json, @createdAt, @updatedAt)`
      ).run({
        id: document._id,
        json: payload,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
      });
    },

    _deleteDocumentById(id) {
      this._ensureTable();
      const db = getSqliteDatabase();
      db.prepare(`DELETE FROM ${tableName} WHERE id = ?`).run(String(id));
    },

    _wrapDocument(document) {
      if (!document) {
        return null;
      }

      const copy = deepClone(document);

      Object.defineProperty(copy, "id", {
        enumerable: false,
        get() {
          return copy._id;
        },
      });

      Object.defineProperty(copy, "toObject", {
        enumerable: false,
        value() {
          return stripFunctions(deepClone(copy));
        },
      });

      return copy;
    },

    _findSync(filter = {}) {
      const filterKeys = Object.keys(filter || {});
      if (filterKeys.length === 1 && filterKeys[0] === "_id") {
        const idFilter = filter._id;

        if (!isOperatorObject(idFilter)) {
          const row = this._loadRawRowById(idFilter);
          return row ? [this._decodeRow(row)] : [];
        }

        if (
          isOperatorObject(idFilter) &&
          Object.keys(idFilter).length === 1 &&
          Array.isArray(idFilter.$in)
        ) {
          return this._loadRawRowsByIds(idFilter.$in).map((row) => this._decodeRow(row));
        }
      }

      const rows = this._loadRawRows();
      const documents = rows.map((row) => this._decodeRow(row));
      return documents.filter((document) => matchesFilter(document, filter));
    },

    _findOneSync(filter = {}) {
      const items = this._findSync(filter);
      return items[0] || null;
    },

    _findByIdSync(id) {
      const row = this._loadRawRowById(id);
      if (!row) {
        return null;
      }

      return this._decodeRow(row);
    },

    _findByIdsSync(ids = []) {
      return this._loadRawRowsByIds(ids).map((row) => this._decodeRow(row));
    },

    _assertUniqueConstraints(document, ignoreId = null) {
      for (const field of uniqueFields) {
        const value = getByPath(document, field);
        if (value === undefined || value === null || value === "") {
          continue;
        }

        const normalizedValue = normalizeValueForUnique(value);
        const conflicts = this._findSync({ [field]: value });
        const conflict = conflicts.find(
          (item) =>
            item._id !== (ignoreId ? String(ignoreId) : null) &&
            normalizeValueForUnique(getByPath(item, field)) === normalizedValue
        );

        if (conflict) {
          throw createDuplicateError(`${modelName} unique constraint failed: ${field}`);
        }
      }
    },

    _prepareNewDocument(payload = {}) {
      const merged = mergeDefaults(defaults, payload);
      const now = nowIsoString();
      merged._id = String(merged._id || createId());
      merged.createdAt = merged.createdAt || now;
      merged.updatedAt = now;
      return merged;
    },

    _updateDocument(existingDocument, update, options = {}) {
      const isInsert = Boolean(options.isInsert);
      const merged = applyUpdateToDocument(existingDocument, update, isInsert);
      const now = nowIsoString();
      merged._id = String(merged._id || existingDocument?._id || createId());
      merged.createdAt = merged.createdAt || existingDocument?.createdAt || now;
      merged.updatedAt = now;
      return merged;
    },

    _resolvePopulatePath(document, path, targetModelName, resolvedMap = new Map()) {
      if (!targetModelName) {
        return document;
      }

      const resolveSingle = (item) => {
        if (item === null || item === undefined || item === "") {
          return null;
        }

        if (isPlainObject(item) && item._id) {
          return item;
        }

        return resolvedMap.get(normalizeId(item)) || null;
      };

      const value = getByPath(document, path);
      if (value === undefined || value === null) {
        return document;
      }

      const nextValue = Array.isArray(value)
        ? value.map((item) => resolveSingle(item)).filter(Boolean)
        : resolveSingle(value);

      setByPath(document, path, nextValue);
      return document;
    },

    _buildPopulateValueMap(documents = [], path, populateModelName) {
      const targetModelName = populateModelName || this.populate[path];
      if (!targetModelName) {
        return new Map();
      }

      const targetModel = modelRegistry.get(targetModelName);
      if (!targetModel) {
        return new Map();
      }

      const ids = normalizeIdList(
        documents.flatMap((document) => {
          const value = getByPath(document, path);
          if (value === undefined || value === null) {
            return [];
          }

          const items = Array.isArray(value) ? value : [value];
          return items
            .filter((item) => !(isPlainObject(item) && item._id))
            .map((item) => normalizeId(item))
            .filter(Boolean);
        })
      );

      if (ids.length === 0) {
        return new Map();
      }

      return new Map(
        targetModel
          ._findByIdsSync(ids)
          .map((document) => [String(document._id), targetModel._wrapDocument(document)])
      );
    },

    _populateDocuments(documents = [], paths = []) {
      if (!paths || paths.length === 0) {
        return documents;
      }

      const copies = documents.map((item) => deepClone(item));
      for (const path of paths) {
        const targetModelName = this.populate[path];
        if (!targetModelName) {
          continue;
        }

        const resolvedMap = this._buildPopulateValueMap(copies, path, targetModelName);
        for (const copy of copies) {
          this._resolvePopulatePath(copy, path, targetModelName, resolvedMap);
        }
      }

      return copies;
    },

    find(filter = {}) {
      return new LiteQuery(this, { filter });
    },

    findOne(filter = {}) {
      return new LiteQuery(this, { filter, single: true });
    },

    findById(id) {
      const document = this._findByIdSync(id);
      return new LiteQuery(this, {
        filter: { _id: normalizeId(id) },
        single: true,
        preloadedDocs: document ? [document] : [],
      });
    },

    countDocuments(filter = {}) {
      return this._findSync(filter).length;
    },

    create(payload = {}) {
      const document = this._prepareNewDocument(payload);
      this._assertUniqueConstraints(document);
      this._writeDocument(document);
      return this._wrapDocument(document);
    },

    insertMany(payloads = []) {
      const items = Array.isArray(payloads) ? payloads : [];
      const created = [];
      for (const payload of items) {
        created.push(this.create(payload));
      }
      return created;
    },

    findByIdAndDelete(id) {
      const existing = this._findByIdSync(id);
      if (!existing) {
        return null;
      }

      this._deleteDocumentById(existing._id);
      return this._wrapDocument(existing);
    },

    findByIdAndUpdate(id, update = {}, options = {}) {
      const query = new LiteQuery(this, { single: true, preloadedDocs: [] });
      query.exec = () => {
        const existing = this._findByIdSync(id);
        if (!existing) {
          return null;
        }

        const updated = this._updateDocument(existing, update, { isInsert: false });
        this._assertUniqueConstraints(updated, existing._id);
        this._writeDocument(updated);

        let docs = [updated];
        if (query.populatePaths.length > 0) {
          docs = this._populateDocuments(docs, query.populatePaths);
        }

        return this._wrapDocument(docs[0]);
      };

      return query;
    },

    findOneAndUpdate(filter = {}, update = {}, options = {}) {
      const existing = this._findOneSync(filter);

      if (!existing && !options.upsert) {
        return null;
      }

      if (!existing && options.upsert) {
        const base = extractInsertCandidateFromFilter(filter);
        const seeded = mergeDefaults(defaults, base);
        const inserted = this._updateDocument(seeded, update, { isInsert: true });
        const prepared = this._prepareNewDocument(inserted);
        this._assertUniqueConstraints(prepared);
        this._writeDocument(prepared);
        return this._wrapDocument(prepared);
      }

      const updated = this._updateDocument(existing, update, { isInsert: false });
      this._assertUniqueConstraints(updated, existing._id);
      this._writeDocument(updated);

      if (options.new === false) {
        return this._wrapDocument(existing);
      }

      return this._wrapDocument(updated);
    },

    bulkWrite(operations = [], options = {}) {
      const ordered = options?.ordered !== false;
      const stats = {
        upsertedCount: 0,
        matchedCount: 0,
        modifiedCount: 0,
      };

      const list = Array.isArray(operations) ? operations : [];
      for (const operation of list) {
        const updateOne = operation?.updateOne;
        if (!updateOne) {
          continue;
        }

        try {
          const filter = updateOne.filter || {};
          const existing = this._findOneSync(filter);
          if (!existing) {
            if (updateOne.upsert) {
              const base = extractInsertCandidateFromFilter(filter);
              const seeded = mergeDefaults(defaults, base);
              const nextDoc = this._updateDocument(seeded, updateOne.update || {}, {
                isInsert: true,
              });
              const prepared = this._prepareNewDocument(nextDoc);
              this._assertUniqueConstraints(prepared);
              this._writeDocument(prepared);
              stats.upsertedCount += 1;
            }
            continue;
          }

          stats.matchedCount += 1;
          const before = JSON.stringify(stripFunctions(existing));
          const updated = this._updateDocument(existing, updateOne.update || {}, {
            isInsert: false,
          });
          this._assertUniqueConstraints(updated, existing._id);
          this._writeDocument(updated);
          const after = JSON.stringify(stripFunctions(updated));
          if (before !== after) {
            stats.modifiedCount += 1;
          }
        } catch (error) {
          if (ordered) {
            throw error;
          }
        }
      }

      return stats;
    },
  };

  modelRegistry.set(modelName, model);
  return model;
}

export function createLiteModel(config = {}) {
  return buildModel(config);
}

export function getLiteModel(modelName) {
  return modelRegistry.get(modelName) || null;
}
