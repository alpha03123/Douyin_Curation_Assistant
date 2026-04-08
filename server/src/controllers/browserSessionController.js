import {
  getBrowserSessionStatus,
  prepareBrowserSession,
  resetBrowserSession,
} from "../services/browserSessionService.js";
import { z } from "zod";

const browserSessionSchema = z.object({
  targetUrl: z.string().url().optional(),
  deepProfile: z.enum(["runtime", "lab"]).optional(),
});

const deleteBrowserSessionSchema = z.object({
  profileKey: z.enum(["runtime", "lab"]).optional(),
});

export async function getBrowserSession(req, res, next) {
  try {
    const payload = browserSessionSchema.partial().parse(req.query || {});
    const result = await getBrowserSessionStatus(payload);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
}

export async function createBrowserSession(req, res, next) {
  try {
    const payload = browserSessionSchema.parse(req.body || {});
    const result = await prepareBrowserSession(payload);
    res.status(202).json({ data: result });
  } catch (error) {
    next(error);
  }
}

export async function deleteBrowserSession(req, res, next) {
  try {
    const payload = deleteBrowserSessionSchema.parse(req.query || {});
    const result = await resetBrowserSession(payload);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
}
