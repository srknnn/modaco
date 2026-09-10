import { describe, expect, it } from "vitest";
import { applyPricingRules } from "./pricingRules.js";
import { effectivePrice } from "./effectivePrice.js";
import { DiscountType } from "@prisma/client";
import { Prisma } from "@prisma/client";

describe("applyPricingRules", () => {
  it("applies margin and rounds to cents", () => {
    expect(applyPricingRules(100, 0.1)).toBe(110);
    expect(applyPricingRules(40, 0.1)).toBe(44);
  });
});

describe("effectivePrice", () => {
  const base = new Prisma.Decimal("100.00");
  const productPromo = {
    id: "p1",
    name: "SKU 20%",
    discountType: DiscountType.PERCENTAGE,
    value: new Prisma.Decimal("20"),
  };
  const categoryPromo = {
    id: "c1",
    name: "Category 50%",
    discountType: DiscountType.PERCENTAGE,
    value: new Prisma.Decimal("50"),
  };

  it("uses product promotion over category", () => {
    const result = effectivePrice(base, productPromo, categoryPromo);
    expect(Number(result.price)).toBe(80);
    expect(result.promotion?.id).toBe("p1");
  });

  it("falls back to category promotion", () => {
    const result = effectivePrice(base, null, categoryPromo);
    expect(Number(result.price)).toBe(50);
  });
});
