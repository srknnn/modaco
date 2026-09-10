import { DiscountType, type Promotion } from "@prisma/client";
import { Prisma } from "@prisma/client";

export type PricePromotion = Pick<Promotion, "id" | "discountType" | "value" | "name">;

export function applyDiscount(basePrice: Prisma.Decimal, promotion: PricePromotion): Prisma.Decimal {
  const base = Number(basePrice);
  const value = Number(promotion.value);
  const next =
    promotion.discountType === DiscountType.PERCENTAGE
      ? base * (1 - value / 100)
      : base - value;
  const clamped = Math.max(0, Math.round(next * 100) / 100);
  return new Prisma.Decimal(clamped.toFixed(2));
}

export function resolveActivePromotion(
  productPromo: PricePromotion | null,
  categoryPromo: PricePromotion | null,
): PricePromotion | null {
  return productPromo ?? categoryPromo;
}

export function effectivePrice(
  basePrice: Prisma.Decimal,
  productPromo: PricePromotion | null,
  categoryPromo: PricePromotion | null,
): { price: Prisma.Decimal; promotion: PricePromotion | null } {
  const promotion = resolveActivePromotion(productPromo, categoryPromo);
  if (!promotion) {
    return { price: basePrice, promotion: null };
  }
  return { price: applyDiscount(basePrice, promotion), promotion };
}
