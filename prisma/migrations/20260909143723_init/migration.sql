-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PromotionTargetType" AS ENUM ('PRODUCT', 'CATEGORY');

-- CreateEnum
CREATE TYPE "IngestJobStatus" AS ENUM ('PENDING', 'SPLITTING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "IngestChunkStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "basePrice" DECIMAL(12,2) NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discountType" "DiscountType" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" "PromotionStatus" NOT NULL DEFAULT 'ACTIVE',
    "targetType" "PromotionTargetType",
    "productId" TEXT,
    "categoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestJob" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" "IngestJobStatus" NOT NULL DEFAULT 'PENDING',
    "totalChunks" INTEGER NOT NULL DEFAULT 0,
    "processedChunks" INTEGER NOT NULL DEFAULT 0,
    "failedChunks" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestChunk" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" "IngestChunkStatus" NOT NULL DEFAULT 'PENDING',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "Product_categoryId_basePrice_idx" ON "Product"("categoryId", "basePrice");

-- CreateIndex
CREATE INDEX "Promotion_status_startAt_endAt_idx" ON "Promotion"("status", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "Promotion_productId_status_idx" ON "Promotion"("productId", "status");

-- CreateIndex
CREATE INDEX "Promotion_categoryId_status_idx" ON "Promotion"("categoryId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "IngestChunk_jobId_chunkIndex_key" ON "IngestChunk"("jobId", "chunkIndex");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestChunk" ADD CONSTRAINT "IngestChunk_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "IngestJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
