import { Router } from "express";
import multer from "multer";
import { AppError } from "../lib/errors.js";
import { createIngestJob, getIngestJob, replayFailedChunks } from "../services/ingest.service.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

export const ingestRouter = Router();

ingestRouter.post("/jobs", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) throw new AppError(400, "CSV file is required (field name: file)");
    const job = await createIngestJob(req.file.originalname, req.file.buffer);
    res.status(202).json({
      id: job.id,
      status: job.status,
      message: "Accepted. Splitter will slice the file; workers process chunks asynchronously.",
    });
  } catch (error) {
    next(error);
  }
});

ingestRouter.get("/jobs/:id", async (req, res, next) => {
  try {
    res.json(await getIngestJob(req.params.id));
  } catch (error) {
    next(error);
  }
});

ingestRouter.post("/jobs/:id/replay-failed", async (req, res, next) => {
  try {
    res.json(await replayFailedChunks(req.params.id));
  } catch (error) {
    next(error);
  }
});
