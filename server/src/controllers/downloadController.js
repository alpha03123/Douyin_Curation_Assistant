import { z } from "zod";
import {
  createUrlDownloadTask,
  createWorkDownloadTask,
  getDownloadTaskById,
  getDownloadedAssetsByTaskId,
  listDownloadTasks,
  resolveDownloadSourcePreview,
  retryDownloadTask,
} from "../services/douyin/download/taskService.js";

const createDownloadTaskSchema = z
  .object({
    workId: z.string().min(1).optional(),
    sourceUrl: z.string().min(1).optional(),
    assets: z
      .array(z.enum(["video", "images", "cover", "music", "metadata"]))
      .min(1),
    removeWatermark: z.boolean().optional(),
  })
  .refine((payload) => Boolean(payload.workId || payload.sourceUrl), {
    message: "workId or sourceUrl is required.",
  });

const listDownloadTasksSchema = z.object({
  workId: z.string().optional(),
  status: z
    .enum(["pending", "running", "success", "failed", "partial_success"])
    .optional(),
  sourceType: z.enum(["work", "url"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const resolveSourceSchema = z.object({
  sourceUrl: z.string().min(1),
});

export async function createDownloadTask(req, res, next) {
  try {
    const payload = createDownloadTaskSchema.parse(req.body || {});
    const task = payload.workId
      ? await createWorkDownloadTask(payload)
      : await createUrlDownloadTask(payload);
    res.status(201).json({ data: task });
  } catch (error) {
    next(error);
  }
}

export async function listTasks(req, res, next) {
  try {
    const query = listDownloadTasksSchema.parse(req.query || {});
    const items = await listDownloadTasks(query);
    res.json({ data: items });
  } catch (error) {
    next(error);
  }
}

export async function getTask(req, res, next) {
  try {
    const task = await getDownloadTaskById(req.params.taskId);
    res.json({ data: task });
  } catch (error) {
    next(error);
  }
}

export async function listTaskFiles(req, res, next) {
  try {
    const items = await getDownloadedAssetsByTaskId(req.params.taskId);
    res.json({ data: items });
  } catch (error) {
    next(error);
  }
}

export async function retryTask(req, res, next) {
  try {
    const task = await retryDownloadTask(req.params.taskId);
    res.json({ data: task });
  } catch (error) {
    next(error);
  }
}

export async function resolveSource(req, res, next) {
  try {
    const payload = resolveSourceSchema.parse(req.body || {});
    const source = await resolveDownloadSourcePreview(payload.sourceUrl);
    res.json({ data: source });
  } catch (error) {
    next(error);
  }
}
