import { parse } from "csv-parse/sync";
import { Prisma } from "@prisma/client";
import { env } from "../config/env.js";
import { applyPricingRules, slugify, type VendorRow } from "../domain/pricingRules.js";
import { prisma } from "../lib/prisma.js";
import { storage } from "../storage/objectStorage.js";

export type ChunkResult = {
  upserted: number;
  skipped: number;
};

export async function processChunk(storageKey: string): Promise<ChunkResult> {
  const file = await storage.get(storageKey);
  const rows = parseVendorCsv(file.toString("utf8"));
  let skipped = 0;
  const valid: VendorRow[] = [];

  for (const row of rows) {
    try {
      assertVendorRow(row);
      valid.push(row);
    } catch {
      skipped += 1;
    }
  }

  if (valid.length === 0) {
    return { upserted: 0, skipped };
  }

  const categoryNames = [...new Set(valid.map((row) => row.category))];
  const categories = await Promise.all(
    categoryNames.map((name) =>
      prisma.category.upsert({
        where: { slug: slugify(name) },
        update: { name },
        create: { name, slug: slugify(name) },
      }),
    ),
  );
  const categoryBySlug = new Map(categories.map((category) => [category.slug, category]));

  await prisma.$transaction(
    valid.map((row) => {
      const category = categoryBySlug.get(slugify(row.category));
      if (!category) {
        throw new Error(`Category missing for ${row.sku}`);
      }
      const basePrice = applyPricingRules(row.price, env.PRICE_MARGIN);
      return prisma.product.upsert({
        where: { sku: row.sku },
        update: {
          name: row.name,
          categoryId: category.id,
          basePrice: new Prisma.Decimal(basePrice.toFixed(2)),
          stock: row.stock,
        },
        create: {
          sku: row.sku,
          name: row.name,
          categoryId: category.id,
          basePrice: new Prisma.Decimal(basePrice.toFixed(2)),
          stock: row.stock,
        },
      });
    }),
  );

  return { upserted: valid.length, skipped };
}

export function parseVendorCsv(csv: string): VendorRow[] {
  const records = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  return records.map((record) => ({
    sku: record.sku,
    name: record.name,
    category: record.category,
    price: Number(record.price),
    stock: Number(record.stock),
  }));
}

function assertVendorRow(row: VendorRow): void {
  if (!row.sku?.trim()) throw new Error("sku required");
  if (!row.name?.trim()) throw new Error("name required");
  if (!row.category?.trim()) throw new Error("category required");
  if (!Number.isFinite(row.price) || row.price < 0) throw new Error("invalid price");
  if (!Number.isInteger(row.stock) || row.stock < 0) throw new Error("invalid stock");
}
