import { IngestChunkStatus, IngestJobStatus } from "@prisma/client";
import { parse } from "csv-parse";
import { env } from "../config/env.js";
import { maybeCompleteJob } from "./dlq.js";
import { chunkQueue, ingestJobOptions } from "../lib/queue.js";
import { prisma } from "../lib/prisma.js";
import { storage } from "../storage/objectStorage.js";

const HEADER = "sku,name,category,price,stock";

export async function splitIngestJob(jobId: string): Promise<void> {
  const job = await prisma.ingestJob.findUniqueOrThrow({ where: { id: jobId } });
  const inFlight = await prisma.ingestChunk.findFirst({
    where: {
      jobId,
      status: { in: [IngestChunkStatus.PROCESSING, IngestChunkStatus.COMPLETED, IngestChunkStatus.FAILED] },
    },
  });

  if (!inFlight) {
    await materializeChunks(jobId, job.storageKey);
  }

  await enqueuePendingChunks(jobId);
  await maybeCompleteJob(jobId);
}

async function materializeChunks(jobId: string, incomingKey: string): Promise<void> {
  await prisma.$transaction([
    prisma.ingestChunk.deleteMany({ where: { jobId } }),
    prisma.ingestJob.update({
      where: { id: jobId },
      data: {
        status: IngestJobStatus.SPLITTING,
        totalChunks: 0,
        processedChunks: 0,
        failedChunks: 0,
        error: null,
      },
    }),
  ]);

  const rows: string[] = [];
  let chunkIndex = 0;
  const parser = storage.stream(incomingKey).pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }),
  );

  const flush = async (): Promise<void> => {
    if (rows.length === 0) return;
    const currentIndex = chunkIndex;
    const csv = `${HEADER}\n${rows.join("\n")}\n`;
    const storageKey = `chunks/${jobId}/${currentIndex}.csv`;
    await storage.put(storageKey, csv);
    await prisma.ingestChunk.create({
      data: {
        jobId,
        chunkIndex: currentIndex,
        storageKey,
        rowCount: rows.length,
      },
    });
    chunkIndex += 1;
    rows.length = 0;
  };

  for await (const record of parser) {
    const row = record as Record<string, string>;
    rows.push(
      [row.sku, row.name, row.category, row.price, row.stock]
        .map((value) => String(value ?? "").replaceAll(",", " "))
        .join(","),
    );
    if (rows.length >= env.CHUNK_SIZE) {
      await flush();
    }
  }
  await flush();

  await prisma.ingestJob.update({
    where: { id: jobId },
    data: {
      status: chunkIndex === 0 ? IngestJobStatus.COMPLETED : IngestJobStatus.PROCESSING,
      totalChunks: chunkIndex,
    },
  });
}

async function enqueuePendingChunks(jobId: string): Promise<void> {
  const pending = await prisma.ingestChunk.findMany({
    where: { jobId, status: IngestChunkStatus.PENDING },
    orderBy: { chunkIndex: "asc" },
  });

  for (const chunk of pending) {
    try {
      await chunkQueue.add(
        "chunk",
        { jobId, chunkIndex: chunk.chunkIndex, storageKey: chunk.storageKey },
        { ...ingestJobOptions, jobId: `${jobId}-chunk-${chunk.chunkIndex}` },
      );
    } catch {
      // Job id already in Redis from a previous split attempt.
    }
  }
}
