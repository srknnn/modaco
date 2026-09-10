import { DiscountType, Prisma, PromotionStatus, PromotionTargetType, type Promotion } from "@prisma/client";
import type { AssignPromotionDto, CreatePromotionDto, PromotionResponseDto } from "../dto/promotion.dto.js";
import { bumpCategoryGeneration } from "../cache/generation.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

function toPromotionResponse(promotion: Promotion): PromotionResponseDto {
  return {
    id: promotion.id,
    name: promotion.name,
    discountType: promotion.discountType,
    value: Number(promotion.value),
    startAt: promotion.startAt,
    endAt: promotion.endAt,
    status: promotion.status,
    targetType: promotion.targetType,
    productId: promotion.productId,
    categoryId: promotion.categoryId,
    createdAt: promotion.createdAt,
    updatedAt: promotion.updatedAt,
  };
}

export async function createPromotion(body: CreatePromotionDto): Promise<PromotionResponseDto> {
  if (body.endAt <= body.startAt) {
    throw new AppError(400, "endAt must be after startAt");
  }
  if (body.discountType === DiscountType.PERCENTAGE && body.value > 100) {
    throw new AppError(400, "percentage discount cannot exceed 100");
  }
  return toPromotionResponse(
    await prisma.promotion.create({
      data: {
        name: body.name,
        discountType: body.discountType,
        value: new Prisma.Decimal(body.value.toFixed(2)),
        startAt: body.startAt,
        endAt: body.endAt,
      },
    }),
  );
}

export async function assignPromotion(id: string, body: AssignPromotionDto): Promise<PromotionResponseDto> {
  const promotion = await prisma.promotion.findUnique({ where: { id } });
  if (!promotion) throw new AppError(404, "Promotion not found");
  if (promotion.status !== PromotionStatus.ACTIVE) {
    throw new AppError(409, "Cancelled promotions cannot be assigned");
  }

  if (body.targetType === PromotionTargetType.PRODUCT) {
    const product = await prisma.product.findFirst({
      where: { OR: [{ id: body.productId }, { sku: body.sku }] },
    });
    if (!product) throw new AppError(404, "Product not found");

    const existing = await prisma.promotion.findFirst({
      where: {
        id: { not: id },
        status: PromotionStatus.ACTIVE,
        targetType: PromotionTargetType.PRODUCT,
        productId: product.id,
        startAt: { lte: promotion.endAt },
        endAt: { gte: promotion.startAt },
      },
    });
    if (existing) {
      throw new AppError(409, "Product already has an overlapping active promotion");
    }

    const updated = await prisma.promotion.update({
      where: { id },
      data: {
        targetType: PromotionTargetType.PRODUCT,
        productId: product.id,
        categoryId: null,
      },
    });
    await bumpCategoryGeneration(product.categoryId);
    return toPromotionResponse(updated);
  }

  const category = await prisma.category.findFirst({
    where: { OR: [{ id: body.categoryId }, { slug: body.category }, { name: body.category }] },
  });
  if (!category) throw new AppError(404, "Category not found");

  const existing = await prisma.promotion.findFirst({
    where: {
      id: { not: id },
      status: PromotionStatus.ACTIVE,
      targetType: PromotionTargetType.CATEGORY,
      categoryId: category.id,
      startAt: { lte: promotion.endAt },
      endAt: { gte: promotion.startAt },
    },
  });
  if (existing) {
    throw new AppError(409, "Category already has an overlapping active promotion");
  }

  const updated = await prisma.promotion.update({
    where: { id },
    data: {
      targetType: PromotionTargetType.CATEGORY,
      categoryId: category.id,
      productId: null,
    },
  });
  await bumpCategoryGeneration(category.id);
  return toPromotionResponse(updated);
}

export async function cancelPromotion(id: string): Promise<PromotionResponseDto> {
  const promotion = await prisma.promotion.findUnique({ where: { id } });
  if (!promotion) throw new AppError(404, "Promotion not found");

  const updated = await prisma.promotion.update({
    where: { id },
    data: { status: PromotionStatus.CANCELLED },
  });

  if (promotion.categoryId) {
    await bumpCategoryGeneration(promotion.categoryId);
  } else if (promotion.productId) {
    const product = await prisma.product.findUnique({ where: { id: promotion.productId } });
    if (product) await bumpCategoryGeneration(product.categoryId);
  }
  return toPromotionResponse(updated);
}

export async function listPromotions(): Promise<PromotionResponseDto[]> {
  const promotions = await prisma.promotion.findMany({ orderBy: { createdAt: "desc" } });
  return promotions.map(toPromotionResponse);
}
