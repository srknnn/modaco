import { Queue } from "bullmq";
import { env } from "../config/env.js";

export const bullmqConnection = {
  url: env.REDIS_URL,
  maxRetriesPerRequest: null,
};

export const SPLIT_QUEUE = "ingest-split";
export const CHUNK_QUEUE = "ingest-chunks";
export const SPLIT_DLQ = "ingest-split-dlq";
export const CHUNK_DLQ = "ingest-chunks-dlq";

export const INGEST_ATTEMPTS = 3;

export const ingestJobOptions = {
  attempts: INGEST_ATTEMPTS,
  backoff: { type: "exponential" as const, delay: 1000 },
  removeOnComplete: 100,
  removeOnFail: false,
};

export type SplitJobData = { jobId: string };
export type ChunkJobData = {
  jobId: string;
  chunkIndex: number;
  storageKey: string;
};

export const splitQueue = new Queue<SplitJobData>(SPLIT_QUEUE, { connection: bullmqConnection });
export const chunkQueue = new Queue<ChunkJobData>(CHUNK_QUEUE, { connection: bullmqConnection });
export const splitDlq = new Queue<SplitJobData>(SPLIT_DLQ, { connection: bullmqConnection });
export const chunkDlq = new Queue<ChunkJobData>(CHUNK_DLQ, { connection: bullmqConnection });
