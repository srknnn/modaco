import type { ProductListResponseDto, ProductResponseDto } from "../dto/product.dto.js";
import { redis } from "../lib/redis.js";
import {
  getCategoryGeneration,
  listCacheKey,
  productCacheKey,
} from "./generation.js";

const PRODUCT_TTL_SECONDS = 60;
const LIST_TTL_SECONDS = 45;

export async function getCachedJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function setCachedJson<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // Storefront must not 500 if Redis is down.
  }
}

export async function readProductCache(
  productId: string,
  categoryId: string,
): Promise<ProductResponseDto | null> {
  try {
    const generation = await getCategoryGeneration(categoryId);
    return await getCachedJson<ProductResponseDto>(productCacheKey(productId, generation));
  } catch {
    return null;
  }
}

export async function writeProductCache(
  productId: string,
  categoryId: string,
  value: ProductResponseDto,
): Promise<void> {
  try {
    const generation = await getCategoryGeneration(categoryId);
    await setCachedJson(productCacheKey(productId, generation), value, PRODUCT_TTL_SECONDS);
  } catch {
    // miss-on-read next time
  }
}

export async function readListCache(params: {
  categoryId: string | "all";
  sort: string;
  page: number;
  limit: number;
}): Promise<ProductListResponseDto | null> {
  try {
    const generation = await getCategoryGeneration(params.categoryId);
    return await getCachedJson<ProductListResponseDto>(listCacheKey({ ...params, generation }));
  } catch {
    return null;
  }
}

export async function writeListCache(
  params: { categoryId: string | "all"; sort: string; page: number; limit: number },
  value: ProductListResponseDto,
): Promise<void> {
  try {
    const generation = await getCategoryGeneration(params.categoryId);
    await setCachedJson(listCacheKey({ ...params, generation }), value, LIST_TTL_SECONDS);
  } catch {
    // miss-on-read next time
  }
}
