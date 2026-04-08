import { z } from "zod";
import { Keyword } from "../models/Keyword.js";

const keywordSchema = z.object({
  keyword: z.string().min(1),
  enabled: z.boolean().optional(),
  dailyLimit: z.number().int().positive().optional(),
  note: z.string().optional(),
});

const keywordUpdateSchema = keywordSchema.partial().refine(
  (payload) => Object.keys(payload).length > 0,
  {
    message: "At least one field is required.",
  }
);

function normalizeStorageError(error) {
  if (error?.code === 11000) {
    error.statusCode = 409;
    error.message = "Keyword already exists.";
  }

  return error;
}

export async function listKeywords(req, res, next) {
  try {
    const items = await Keyword.find().sort({ createdAt: -1 });
    res.json({ data: items });
  } catch (error) {
    next(error);
  }
}

export async function createKeyword(req, res, next) {
  try {
    const payload = keywordSchema.parse(req.body);
    const item = await Keyword.create(payload);
    res.status(201).json({ data: item });
  } catch (error) {
    next(normalizeStorageError(error));
  }
}

export async function updateKeyword(req, res, next) {
  try {
    const payload = keywordUpdateSchema.parse(req.body || {});
    const item = await Keyword.findByIdAndUpdate(req.params.keywordId, payload, {
      new: true,
      runValidators: true,
    });

    if (!item) {
      const error = new Error("Keyword not found.");
      error.statusCode = 404;
      throw error;
    }

    res.json({ data: item });
  } catch (error) {
    next(normalizeStorageError(error));
  }
}

export async function deleteKeyword(req, res, next) {
  try {
    const item = await Keyword.findByIdAndDelete(req.params.keywordId);
    if (!item) {
      const error = new Error("Keyword not found.");
      error.statusCode = 404;
      throw error;
    }

    res.json({
      data: {
        deleted: true,
        id: req.params.keywordId,
      },
    });
  } catch (error) {
    next(error);
  }
}
