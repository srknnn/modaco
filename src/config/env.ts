import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  UPLOAD_DIR: z.string().default("./uploads"),
  CHUNK_SIZE: z.coerce.number().int().positive().default(100),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  PRICE_MARGIN: z.coerce.number().min(0).default(0.1),
});

export const env = envSchema.parse(process.env);
