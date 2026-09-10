import { PromotionStatus, PromotionTargetType, type Product, type Promotion } from "@prisma/client";
import type { ProductResponseDto } from "../dto/product.dto.js";
import { effectivePrice, type PricePromotion } from "../domain/effectivePrice.js";
import { prisma } from "../lib/prisma.js";

function activePromotionWhere(now = new Date()) {
  return {
    status: PromotionStatus.ACTIVE,
    startAt: { lte: now },
    endAt: { gte: now },
  };
}

export function toProductResponse(
  product: Product & { category: { id: string; name: string; slug: string } },
  productPromo: PricePromotion | null,
  categoryPromo: PricePromotion | null,
): ProductResponseDto {
  const resolved = effectivePrice(product.basePrice, productPromo, categoryPromo);
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    category: {
      id: product.category.id,
      name: product.category.name,
      slug: product.category.slug,
    },
    stock: product.stock,
    basePrice: Number(product.basePrice),
    effectivePrice: Number(resolved.price),
    activePromotion: resolved.promotion
      ? {
          id: resolved.promotion.id,
          name: resolved.promotion.name,
          discountType: resolved.promotion.discountType,
          value: Number(resolved.promotion.value),
        }
      : null,
  };
}

export async function mapProductsWithPromotions(
  products: Array<Product & { category: { id: string; name: string; slug: string } }>,
): Promise<ProductResponseDto[]> {
  if (products.length === 0) return [];

  const productIds = products.map((product) => product.id);
  const categoryIds = [...new Set(products.map((product) => product.categoryId))];
  const promotions = await prisma.promotion.findMany({
    where: {
      ...activePromotionWhere(),
      OR: [
        { targetType: PromotionTargetType.PRODUCT, productId: { in: productIds } },
        { targetType: PromotionTargetType.CATEGORY, categoryId: { in: categoryIds } },
      ],
    },
  });

  const productPromoById = new Map<string, Promotion>();
  const categoryPromoById = new Map<string, Promotion>();
  for (const promotion of promotions) {
    if (promotion.targetType === PromotionTargetType.PRODUCT && promotion.productId) {
      productPromoById.set(promotion.productId, promotion);
    }
    if (promotion.targetType === PromotionTargetType.CATEGORY && promotion.categoryId) {
      categoryPromoById.set(promotion.categoryId, promotion);
    }
  }

  return products.map((product) =>
    toProductResponse(
      product,
      productPromoById.get(product.id) ?? null,
      categoryPromoById.get(product.categoryId) ?? null,
    ),
  );
}
