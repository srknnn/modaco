import { IngestChunkStatus, IngestJobStatus } from "@prisma/client";
import type { Job } from "bullmq";
import { prisma } from "../lib/prisma.js";
import {
  chunkDlq,
  INGEST_ATTEMPTS,
  splitDlq,
  type ChunkJobData,
  type SplitJobData,
} from "../lib/queue.js";

export function isLastAttempt(job: Job | undefined): boolean {
  if (!job) return true;
  const max = job.opts.attempts ?? INGEST_ATTEMPTS;
  return job.attemptsMade >= max;
}

export async function sendChunkToDlq(data: ChunkJobData, error: Error): Promise<void> {
  try {
    await chunkDlq.add("dead-letter", data, {
      jobId: `dlq-${data.jobId}-chunk-${data.chunkIndex}`,
      removeOnComplete: false,
      removeOnFail: false,
    });
  } catch {
    // Same DLQ job id from a duplicate "failed" event — ledger update below is idempotent.
  }
  await markChunkDeadLettered(data, error.message);
}

export async function sendSplitToDlq(data: SplitJobData, error: Error): Promise<void> {
  try {
    await splitDlq.add("dead-letter", data, {
      jobId: `dlq-split-${data.jobId}`,
      removeOnComplete: false,
      removeOnFail: false,
    });
  } catch {
    // duplicate DLQ ticket
  }
  await prisma.ingestJob.update({
    where: { id: data.jobId },
    data: {
      status: IngestJobStatus.FAILED,
      error: error.message,
    },
  });
}

async function markChunkDeadLettered(data: ChunkJobData, message: string): Promise<void> {
  const moved = await prisma.ingestChunk.updateMany({
    where: {
      jobId: data.jobId,
      chunkIndex: data.chunkIndex,
      status: { not: IngestChunkStatus.FAILED },
    },
    data: {
      status: IngestChunkStatus.FAILED,
      error: message,
      dlqAt: new Date(),
    },
  });
  if (moved.count === 0) return;

  await prisma.ingestJob.update({
    where: { id: data.jobId },
    data: { failedChunks: { increment: 1 } },
  });
  await maybeCompleteJob(data.jobId);
}

export async function maybeCompleteJob(jobId: string): Promise<void> {
  const job = await prisma.ingestJob.findUniqueOrThrow({ where: { id: jobId } });
  if (job.totalChunks === 0) return;
  if (job.processedChunks + job.failedChunks < job.totalChunks) return;

  await prisma.ingestJob.update({
    where: { id: jobId },
    data: {
      status: job.failedChunks > 0 ? IngestJobStatus.FAILED : IngestJobStatus.COMPLETED,
    },
  });
}
