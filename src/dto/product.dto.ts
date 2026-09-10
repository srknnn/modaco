import { DiscountType } from "@prisma/client";
import { z } from "zod";

export const listProductsQuerySchema = z.object({
  category: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sort: z.enum(["effectivePrice", "-effectivePrice"]).default("effectivePrice"),
});

export type ListProductsQueryDto = z.infer<typeof listProductsQuerySchema>;

export const createProductSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  basePrice: z.number().nonnegative(),
  stock: z.number().int().nonnegative().default(0),
});

export type CreateProductDto = z.infer<typeof createProductSchema>;

export type CategoryDto = {
  id: string;
  name: string;
  slug: string;
};

export type ActivePromotionDto = {
  id: string;
  name: string;
  discountType: DiscountType;
  value: number;
};

export type ProductResponseDto = {
  id: string;
  sku: string;
  name: string;
  category: CategoryDto;
  stock: number;
  basePrice: number;
  effectivePrice: number;
  activePromotion: ActivePromotionDto | null;
};

export type ProductListMetaDto = {
  page: number;
  limit: number;
  total: number;
  sort: ListProductsQueryDto["sort"];
  note: string;
};

export type ProductListResponseDto = {
  data: ProductResponseDto[];
  meta: ProductListMetaDto;
};
