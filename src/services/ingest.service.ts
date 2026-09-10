import { randomUUID } from "node:crypto";
import { IngestChunkStatus, IngestJobStatus } from "@prisma/client";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { chunkQueue, ingestJobOptions, splitQueue } from "../lib/queue.js";
import { storage } from "../storage/objectStorage.js";

export async function createIngestJob(filename: string, contents: Buffer) {
  const jobId = randomUUID();
  const storageKey = `incoming/${jobId}/${filename}`;
  await storage.put(storageKey, contents);

  const job = await prisma.ingestJob.create({
    data: {
      id: jobId,
      filename,
      storageKey,
      status: IngestJobStatus.PENDING,
    },
  });

  await splitQueue.add("split", { jobId }, { ...ingestJobOptions, jobId });
  return job;
}

export async function getIngestJob(id: string) {
  const job = await prisma.ingestJob.findUnique({
    where: { id },
    include: { chunks: { orderBy: { chunkIndex: "asc" } } },
  });
  if (!job) throw new AppError(404, "Ingest job not found");
  return job;
}

export async function replayFailedChunks(jobId: string) {
  const job = await prisma.ingestJob.findUnique({ where: { id: jobId } });
  if (!job) throw new AppError(404, "Ingest job not found");

  const failed = await prisma.ingestChunk.findMany({
    where: { jobId, status: IngestChunkStatus.FAILED },
    orderBy: { chunkIndex: "asc" },
  });
  if (failed.length === 0) {
    throw new AppError(409, "No failed chunks to replay");
  }

  await prisma.$transaction([
    prisma.ingestChunk.updateMany({
      where: { jobId, status: IngestChunkStatus.FAILED },
      data: { status: IngestChunkStatus.PENDING, error: null, dlqAt: null },
    }),
    prisma.ingestJob.update({
      where: { id: jobId },
      data: {
        status: IngestJobStatus.PROCESSING,
        failedChunks: Math.max(0, job.failedChunks - failed.length),
        error: null,
      },
    }),
  ]);

  const replayToken = Date.now();
  for (const chunk of failed) {
    await chunkQueue.add(
      "chunk",
      { jobId, chunkIndex: chunk.chunkIndex, storageKey: chunk.storageKey },
      { ...ingestJobOptions, jobId: `${jobId}-chunk-${chunk.chunkIndex}-replay-${replayToken}` },
    );
  }

  return {
    jobId,
    replayed: failed.map((chunk) => chunk.chunkIndex),
    message: "Failed chunks re-queued. Upsert-by-SKU and COMPLETED short-circuit make replay idempotent.",
  };
}
