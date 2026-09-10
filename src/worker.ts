import { Worker } from "bullmq";
import { env } from "./config/env.js";
import { isLastAttempt, sendChunkToDlq, sendSplitToDlq } from "./ingest/dlq.js";
import { splitIngestJob } from "./ingest/splitter.js";
import { handleChunkJob } from "./ingest/handleChunkJob.js";
import { CHUNK_QUEUE, INGEST_ATTEMPTS, SPLIT_QUEUE, bullmqConnection } from "./lib/queue.js";
import { prisma } from "./lib/prisma.js";
import { redis } from "./lib/redis.js";

const splitWorker = new Worker(
  SPLIT_QUEUE,
  async (job) => {
    await splitIngestJob(job.data.jobId);
  },
  { connection: bullmqConnection, concurrency: 1 },
);

const chunkWorker = new Worker(
  CHUNK_QUEUE,
  async (job) => {
    await handleChunkJob(job.data);
  },
  { connection: bullmqConnection, concurrency: env.WORKER_CONCURRENCY },
);

splitWorker.on("failed", (job, error) => {
  console.error("split job failed", job?.id, error);
  if (!job || !isLastAttempt(job)) return;
  const err = error instanceof Error ? error : new Error(String(error));
  void sendSplitToDlq(job.data, err).catch((dlqError) => {
    console.error("split DLQ write failed", dlqError);
  });
});

chunkWorker.on("failed", (job, error) => {
  console.error("chunk job failed", job?.id, error);
  if (!job || !isLastAttempt(job)) return;
  const err = error instanceof Error ? error : new Error(String(error));
  void sendChunkToDlq(job.data, err).catch((dlqError) => {
    console.error("chunk DLQ write failed", dlqError);
  });
});

console.log(
  `Ingest worker listening (split concurrency=1, chunk concurrency=${env.WORKER_CONCURRENCY}, DLQ after ${INGEST_ATTEMPTS} attempts)`,
);

async function shutdown(): Promise<void> {
  await splitWorker.close();
  await chunkWorker.close();
  await prisma.$disconnect();
  redis.disconnect();
}

process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});
