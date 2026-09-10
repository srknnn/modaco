export type VendorRow = {
  sku: string;
  name: string;
  category: string;
  price: number;
  stock: number;
};

export function applyPricingRules(vendorPrice: number, margin: number): number {
  if (!Number.isFinite(vendorPrice) || vendorPrice < 0) {
    throw new Error("Vendor price must be a non-negative number");
  }
  const withMargin = vendorPrice * (1 + margin);
  return Math.round(withMargin * 100) / 100;
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
