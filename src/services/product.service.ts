import { Prisma } from "@prisma/client";
import type { CreateProductDto, ListProductsQueryDto, ProductListResponseDto, ProductResponseDto } from "../dto/product.dto.js";
import { readListCache, readProductCache, writeListCache, writeProductCache } from "../cache/store.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { mapProductsWithPromotions } from "./productPricing.js";
import { slugify } from "../domain/pricingRules.js";

export async function listProducts(query: ListProductsQueryDto): Promise<ProductListResponseDto> {
  const category = query.category
    ? await prisma.category.findFirst({
        where: { OR: [{ slug: query.category }, { name: query.category }] },
      })
    : null;

  if (query.category && !category) {
    throw new AppError(404, "Category not found");
  }

  const cacheParams = {
    categoryId: category?.id ?? "all",
    sort: query.sort,
    page: query.page,
    limit: query.limit,
  };
  const cached = await readListCache(cacheParams);
  if (cached) return cached;

  const where = category ? { categoryId: category.id } : {};
  const [total, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: { category: true },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      orderBy: { basePrice: query.sort === "effectivePrice" ? "asc" : "desc" },
    }),
  ]);

  const data = await mapProductsWithPromotions(products);
  if (query.sort === "-effectivePrice") {
    data.sort((a, b) => b.effectivePrice - a.effectivePrice);
  } else {
    data.sort((a, b) => a.effectivePrice - b.effectivePrice);
  }

  const result: ProductListResponseDto = {
    data,
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      sort: query.sort,
      note: "Uniform category percentage/fixed discounts keep the same order as basePrice; mixed SKU overrides are resolved after fetch.",
    },
  };
  await writeListCache(cacheParams, result);
  return result;
}

export async function getProduct(id: string): Promise<ProductResponseDto> {
  const product = await prisma.product.findFirst({
    where: { OR: [{ id }, { sku: id }] },
    include: { category: true },
  });
  if (!product) throw new AppError(404, "Product not found");

  const cached = await readProductCache(product.id, product.categoryId);
  if (cached) return cached;

  const [mapped] = await mapProductsWithPromotions([product]);
  await writeProductCache(product.id, product.categoryId, mapped);
  return mapped;
}

export async function createProduct(body: CreateProductDto): Promise<ProductResponseDto> {
  const category = await prisma.category.upsert({
    where: { slug: slugify(body.category) },
    update: { name: body.category },
    create: { name: body.category, slug: slugify(body.category) },
  });

  try {
    const product = await prisma.product.create({
      data: {
        sku: body.sku,
        name: body.name,
        categoryId: category.id,
        basePrice: new Prisma.Decimal(body.basePrice.toFixed(2)),
        stock: body.stock,
      },
      include: { category: true },
    });
    const [mapped] = await mapProductsWithPromotions([product]);
    return mapped;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(409, "SKU already exists");
    }
    throw error;
  }
}
