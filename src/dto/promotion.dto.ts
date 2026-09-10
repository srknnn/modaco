import { DiscountType, PromotionStatus, PromotionTargetType } from "@prisma/client";
import { z } from "zod";

export const createPromotionSchema = z.object({
  name: z.string().min(1),
  discountType: z.nativeEnum(DiscountType),
  value: z.number().positive(),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
});

export type CreatePromotionDto = z.infer<typeof createPromotionSchema>;

export const assignPromotionSchema = z
  .object({
    targetType: z.nativeEnum(PromotionTargetType),
    productId: z.string().optional(),
    sku: z.string().optional(),
    categoryId: z.string().optional(),
    category: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.targetType === PromotionTargetType.PRODUCT && !value.productId && !value.sku) {
      ctx.addIssue({ code: "custom", message: "productId or sku is required" });
    }
    if (value.targetType === PromotionTargetType.CATEGORY && !value.categoryId && !value.category) {
      ctx.addIssue({ code: "custom", message: "categoryId or category is required" });
    }
  });

export type AssignPromotionDto = z.infer<typeof assignPromotionSchema>;

export type PromotionResponseDto = {
  id: string;
  name: string;
  discountType: DiscountType;
  value: number;
  startAt: Date;
  endAt: Date;
  status: PromotionStatus;
  targetType: PromotionTargetType | null;
  productId: string | null;
  categoryId: string | null;
  createdAt: Date;
  updatedAt: Date;
};
