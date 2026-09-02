import { Plus, Minus, ChevronRight, Image as ImageIcon } from "lucide-react";
import { formatIDR, cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

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

export function ChooseItemsStep({
  products,
  batches,
  activeSource,
  onSourceChange,
  quantities,
  onQuantityChange,
  itemsError,
  onOpenDetail,
  paymentType,
  onPaymentTypeChange,
  loadError,
}: {
  products: ProductRow[] | null;
  batches: BatchOption[];
  activeSource: string;
  onSourceChange: (source: string) => void;
  quantities: Record<string, number>;
  onQuantityChange: (variantId: string, qty: number) => void;
  itemsError: string | null;
  onOpenDetail: (target: DetailTarget) => void;
  paymentType: "DP" | "FULL";
  onPaymentTypeChange: (type: "DP" | "FULL") => void;
  loadError: string | null;
}) {
  const activeBatch = activeSource === "READY_STOCK" ? null : batches.find((b) => b.id === activeSource) ?? null;

  return (
    <>
      {batches !== null && batches.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => onSourceChange("READY_STOCK")}
            className={cn(
              "text-sm font-medium px-3.5 py-1.5 rounded-full border transition-colors",
              activeSource === "READY_STOCK"
                ? "bg-primary text-primary-foreground border-primary shadow-xs"
                : "bg-card hover:bg-muted"
            )}
          >
            Ready stock
          </button>
          {batches.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => onSourceChange(b.id)}
              className={cn(
                "text-sm font-medium px-3.5 py-1.5 rounded-full border transition-colors",
                activeSource === b.id
                  ? "bg-primary text-primary-foreground border-primary shadow-xs"
                  : "bg-card hover:bg-muted"
              )}
            >
              {b.name} (pre-order)
            </button>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadError && <p className="text-destructive text-sm">{loadError}</p>}
          {!loadError && products === null && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[0, 1].map((i) => (
                <div key={i} className="rounded-lg border bg-card overflow-hidden">
                  <Skeleton className="aspect-[4/3] rounded-none" />
                  <div className="p-3 space-y-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                    <Skeleton className="h-7 w-full mt-2" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {activeSource === "READY_STOCK" && products !== null && products.length === 0 && (
            <p className="text-muted-foreground text-sm">Nothing available to order right now.</p>
          )}

          {activeSource === "READY_STOCK" && products !== null && products.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {products.map((product) => (
                <div key={product.id} className="rounded-lg border bg-card overflow-hidden">
                  <ProductPhotoButton
                    photoUrls={photoUrlsOf(product)}
                    name={product.name}
                    onOpen={() =>
                      onOpenDetail({
                        name: product.name,
                        description: product.description,
                        photoUrls: photoUrlsOf(product),
                        rows: product.product_variants.map((v) => ({
                          variantId: v.id,
                          label: `${v.name} — ${formatIDR(v.price)}`,
                        })),
                      })
                    }
                  />
                  <div className="p-3 space-y-2">
                    <div>
                      <p className="font-medium">{product.name}</p>
                      {product.description && (
                        <p className="text-sm text-muted-foreground line-clamp-1">{product.description}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      {product.product_variants.map((variant) => (
                        <QuantityRow
                          key={variant.id}
                          label={`${variant.name} — ${formatIDR(variant.price)}`}
                          qty={quantities[variant.id] ?? 0}
                          onChange={(qty) => onQuantityChange(variant.id, qty)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeBatch && (
            <div className="space-y-2">
              {activeBatch.items.length === 0 && (
                <p className="text-muted-foreground text-sm">This batch has no items yet.</p>
              )}
              {activeBatch.items.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {activeBatch.items.map((item) => (
                    <div key={item.variantId} className="rounded-lg border bg-card overflow-hidden">
                      <ProductPhotoButton
                        photoUrls={item.photoUrls}
                        name={item.productName}
                        onOpen={() =>
                          onOpenDetail({
                            name: item.productName,
                            description: item.description,
                            photoUrls: item.photoUrls,
                            rows: [
                              { variantId: item.variantId, label: `${item.variantName} — ${formatIDR(item.price)}` },
                            ],
                          })
                        }
                      />
                      <div className="p-3 space-y-2">
                        <p className="text-sm">
                          {item.label} — {formatIDR(item.price)}
                        </p>
                        <QuantityRow
                          qty={quantities[item.variantId] ?? 0}
                          onChange={(qty) => onQuantityChange(item.variantId, qty)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {activeBatch.allowedPaymentTypes.length > 1 && (
                <div className="pt-3 mt-2 border-t flex flex-wrap gap-4 text-sm">
                  {activeBatch.allowedPaymentTypes.includes("FULL") && (
                    <label className="flex items-center gap-1.5">
                      <input
                        type="radio"
                        checked={paymentType === "FULL"}
                        onChange={() => onPaymentTypeChange("FULL")}
                        className="accent-primary"
                      />
                      Pay in full
                    </label>
                  )}
                  {activeBatch.allowedPaymentTypes.includes("DP") && (
                    <label className="flex items-center gap-1.5">
                      <input
                        type="radio"
                        checked={paymentType === "DP"}
                        onChange={() => onPaymentTypeChange("DP")}
                        className="accent-primary"
                      />
                      Pay 50% deposit now
                    </label>
                  )}
                </div>
              )}
            </div>
          )}

          {itemsError && <p className="text-destructive text-sm">{itemsError}</p>}
        </CardContent>
      </Card>
    </>
  );
}

/** The 4:3 photo at the top of an item card. Tapping it opens the detail sheet. */
function ProductPhotoButton({
  photoUrls,
  name,
  onOpen,
}: {
  photoUrls: string[];
  name: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative block aspect-[4/3] w-full overflow-hidden bg-muted text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {photoUrls.length > 0 ? (
        <img src={photoUrls[0]} alt={name} className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
          No photo
        </span>
      )}

      {photoUrls.length > 1 && (
        <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-foreground/60 px-2 py-0.5 text-[11px] font-semibold leading-4 text-background">
          <ImageIcon className="size-3" />
          {photoUrls.length}
        </span>
      )}

      <span className="absolute bottom-2 left-2 flex items-center gap-0.5 rounded-full bg-background/90 px-2.5 py-1 text-[11px] font-semibold leading-4 transition-colors group-hover:bg-background">
        Tap for details
        <ChevronRight className="size-3" />
      </span>
    </button>
  );
}

export function QuantityRow({ label, qty, onChange }: { label?: string; qty: number; onChange: (qty: number) => void }) {
  return (
    <div className="flex items-center justify-between text-sm gap-2">
      {label && <span>{label}</span>}
      <div className={cn("flex items-center gap-2", !label && "ml-auto")}>
        <button
          type="button"
          disabled={qty <= 0}
          onClick={() => onChange(qty - 1)}
          className="flex size-7 shrink-0 items-center justify-center rounded-full border disabled:opacity-35 disabled:pointer-events-none hover:bg-muted transition-colors"
        >
          <Minus className="size-3.5" />
        </button>
        <span className="w-5 text-center font-medium">{qty}</span>
        <button
          type="button"
          onClick={() => onChange(qty + 1)}
          className="flex size-7 shrink-0 items-center justify-center rounded-full border hover:bg-muted transition-colors"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
