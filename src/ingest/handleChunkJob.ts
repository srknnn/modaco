import { IngestChunkStatus } from "@prisma/client";
import { maybeCompleteJob } from "./dlq.js";
import { processChunk } from "./processChunk.js";
import { prisma } from "../lib/prisma.js";
import type { ChunkJobData } from "../lib/queue.js";

export async function handleChunkJob(data: ChunkJobData): Promise<void> {
  const existing = await prisma.ingestChunk.findUnique({
    where: { jobId_chunkIndex: { jobId: data.jobId, chunkIndex: data.chunkIndex } },
  });
  if (!existing) {
    throw new Error(`Unknown chunk ${data.jobId}#${data.chunkIndex}`);
  }
  if (existing.status === IngestChunkStatus.COMPLETED) {
    return;
  }

  await prisma.ingestChunk.update({
    where: { jobId_chunkIndex: { jobId: data.jobId, chunkIndex: data.chunkIndex } },
    data: { status: IngestChunkStatus.PROCESSING },
  });

  try {
    await processChunk(data.storageKey);
    const completed = await prisma.ingestChunk.updateMany({
      where: {
        jobId: data.jobId,
        chunkIndex: data.chunkIndex,
        status: { not: IngestChunkStatus.COMPLETED },
      },
      data: { status: IngestChunkStatus.COMPLETED, error: null, dlqAt: null },
    });
    if (completed.count > 0) {
      await prisma.ingestJob.update({
        where: { id: data.jobId },
        data: { processedChunks: { increment: 1 } },
      });
    }
    await maybeCompleteJob(data.jobId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "chunk failed";
    await prisma.ingestChunk.updateMany({
      where: {
        jobId: data.jobId,
        chunkIndex: data.chunkIndex,
        status: { not: IngestChunkStatus.COMPLETED },
      },
      data: { error: message },
    });
    throw error;
  }
}
