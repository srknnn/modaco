import { redis } from "../lib/redis.js";

export async function getCategoryGeneration(categoryId: string): Promise<number> {
  const value = await redis.get(generationKey(categoryId));
  return value ? Number(value) : 0;
}

export async function bumpCategoryGeneration(categoryId: string): Promise<number> {
  return redis.incr(generationKey(categoryId));
}

export function productCacheKey(productId: string, generation: number): string {
  return `product:${productId}:g${generation}`;
}

export function listCacheKey(params: {
  categoryId: string | "all";
  sort: string;
  page: number;
  limit: number;
  generation: number;
}): string {
  return `list:${params.categoryId}:${params.sort}:${params.page}:${params.limit}:g${params.generation}`;
}

function generationKey(categoryId: string): string {
  return `category_gen:${categoryId}`;
}
