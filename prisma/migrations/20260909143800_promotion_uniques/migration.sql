CREATE UNIQUE INDEX "promotions_one_active_product"
ON "Promotion" ("productId")
WHERE status = 'ACTIVE' AND "targetType" = 'PRODUCT' AND "productId" IS NOT NULL;

CREATE UNIQUE INDEX "promotions_one_active_category"
ON "Promotion" ("categoryId")
WHERE status = 'ACTIVE' AND "targetType" = 'CATEGORY' AND "categoryId" IS NOT NULL;
