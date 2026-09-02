interface VariantRow {
  id: string;
  name: string;
  price: string;
}

export interface ProductImageRow {
  url: string;
  sort_order: number;
}
export interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  product_images: ProductImageRow[];
  product_variants: VariantRow[];
}

/** sort_order is the admin's arrangement; image_url is the cover fallback. */
export function photoUrlsOf(product: { image_url: string | null; product_images?: ProductImageRow[] }): string[] {
  const ordered = [...(product.product_images ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  if (ordered.length > 0) return ordered.map((i) => i.url);
  return product.image_url ? [product.image_url] : [];
}

export interface SelectableItem {
  variantId: string;
  productName: string;
  variantName: string;
  label: string;
  price: string;
  description: string | null;
  photoUrls: string[];
}

export interface BatchOption {
  id: string;
  name: string;
  allowedPaymentTypes: string[];
  allowedFulfilmentMethods: string[];
  items: SelectableItem[];
}

export interface DetailTarget {
  name: string;
  description: string | null;
  photoUrls: string[];
  rows: Array<{ variantId: string; label: string }>;
}
