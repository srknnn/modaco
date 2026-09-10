import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const accessories = await prisma.category.upsert({
    where: { slug: "accessories" },
    update: {},
    create: { name: "Accessories", slug: "accessories" },
  });
  await prisma.category.upsert({
    where: { slug: "shoes" },
    update: {},
    create: { name: "Shoes", slug: "shoes" },
  });

  await prisma.product.upsert({
    where: { sku: "BAG-SEED-1" },
    update: {},
    create: {
      sku: "BAG-SEED-1",
      name: "Canvas tote",
      categoryId: accessories.id,
      basePrice: "49.90",
      stock: 20,
    },
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
