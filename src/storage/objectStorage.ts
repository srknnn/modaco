import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { env } from "../config/env.js";

export type ObjectStorage = {
  put(key: string, body: Buffer | string): Promise<string>;
  get(key: string): Promise<Buffer>;
  stream(key: string): Readable;
};

function resolvePath(key: string): string {
  return path.join(env.UPLOAD_DIR, key);
}

export const localStorage: ObjectStorage = {
  async put(key, body) {
    const filePath = resolvePath(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, body);
    return key;
  },
  async get(key) {
    return readFile(resolvePath(key));
  },
  stream(key) {
    return createReadStream(resolvePath(key));
  },
};

export const storage: ObjectStorage = localStorage;
