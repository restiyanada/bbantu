import { useEffect, useState, useCallback, useRef } from "react";
import { X, Plus, RotateCw, ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "@/lib/supabaseClient";
import { useAdminAuth } from "@/lib/adminAuth";
import { formatIDR } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { FileInput } from "@/components/ui/file-input";
import { Label, RequiredMark, OptionalMark } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import AdminLayout from "@/components/AdminLayout";

const IMAGE_BUCKET = "product-images";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
// Every photo is a Storage object and a download on a slow connection. Six is
// enough to show a garment from several angles plus a size chart.
const MAX_PHOTOS = 6;

const productSchema = z.object({
  name: z.string().trim().min(1, "Product name is required."),
  description: z.string().trim().optional(),
});
type ProductValues = z.infer<typeof productSchema>;

interface VariantDraft {
  /** null for a row the admin just added and we still have to insert. */
  id: string | null;
  name: string;
  price: string;
}

// A photo in the form. `file` is set for one the admin just picked and we still
// have to upload; `rowId` is set for one already stored in product_images. The
// edit screen needs both, so the create form uses the same shape.
interface PhotoDraft {
  key: string;
  url: string;
  file: File | null;
  rowId: string | null;
}

function formatPriceDisplay(raw: string): string {
  const cleaned = raw.replace(/[^0-9,]/g, "");
  const firstComma = cleaned.indexOf(",");
  const intPart = firstComma === -1 ? cleaned : cleaned.slice(0, firstComma);
  const decPart = firstComma === -1 ? undefined : cleaned.slice(firstComma + 1).replace(/,/g, "").slice(0, 2);
  const digitsOnly = intPart.replace(/\./g, "");
  const withThousands = digitsOnly.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decPart !== undefined ? `${withThousands},${decPart}` : withThousands;
}

function parsePriceForSubmit(display: string): string {
  const [intPart, decPart] = display.split(",");
  const digitsOnly = (intPart ?? "").replace(/\./g, "");
  return decPart ? `${digitsOnly}.${decPart}` : digitsOnly;
}

interface RawVariantRow {
  id: string;
  name: string;
  price: string;
}
interface RawProductImageRow {
  id: string;
  url: string;
  sort_order: number;
}
interface RawProductRow {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  active: boolean;
  product_images: RawProductImageRow[];
  product_variants: RawVariantRow[];
}
interface RawInventoryRow {
  variant_id: string;
  on_hand: number;
  reserved: number;
}

interface ProductRow extends RawProductRow {
  inventoryByVariant: Map<string, { onHand: number; reserved: number }>;
}

export default function AdminProductsPage() {
  const { admin } = useAdminAuth();
  const canManage = admin?.canManageProductsBatches ?? false;
  const [products, setProducts] = useState<ProductRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [active, setActive] = useState(true);
  const [variants, setVariants] = useState<VariantDraft[]>([{ id: null, name: "", price: "" }]);
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ProductValues>({ resolver: zodResolver(productSchema) });

  const loadProducts = useCallback(async () => {
    setLoadError(null);

    const { data: rawProducts, error: productsError } = await supabase
      .from("products")
      .select(
        "id, name, description, image_url, active, product_images(id, url, sort_order), product_variants(id, name, price)"
      )
      .order("created_at", { ascending: false });

    if (productsError) {
      setLoadError("Couldn't load products. Please try refreshing.");
      return;
    }

    const rows = (rawProducts as RawProductRow[] | null) ?? [];
    const allVariantIds = rows.flatMap((p) => p.product_variants.map((v) => v.id));

    const { data: inventoryRows } =
      allVariantIds.length > 0
        ? await supabase.from("inventory").select("variant_id, on_hand, reserved").in("variant_id", allVariantIds)
        : { data: [] as RawInventoryRow[] };

    const inventoryByVariant = new Map(
      ((inventoryRows as RawInventoryRow[] | null) ?? []).map((row) => [
        row.variant_id,
        { onHand: row.on_hand, reserved: row.reserved },
      ])
    );

    setProducts(rows.map((p) => ({ ...p, inventoryByVariant })));
  }, []);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    // Clear the input either way, so re-picking the same file fires onChange.
    if (imageInputRef.current) imageInputRef.current.value = "";
    if (picked.length === 0) return;
    setSubmitError(null);

    if (picked.some((f) => !ACCEPTED_IMAGE_TYPES.includes(f.type))) {
      setSubmitError("Photos must be JPEG, PNG, or WebP.");
      return;
    }
    if (picked.some((f) => f.size > MAX_IMAGE_BYTES)) {
      setSubmitError("Each photo must be under 5MB.");
      return;
    }

    setPhotos((prev) => {
      const room = MAX_PHOTOS - prev.length;
      if (room <= 0) {
        setSubmitError(`You can add up to ${MAX_PHOTOS} photos.`);
        return prev;
      }
      if (picked.length > room) {
        setSubmitError(`Only the first ${room} were added — the limit is ${MAX_PHOTOS} photos.`);
      }
      const added = picked.slice(0, room).map((file) => ({
        key: crypto.randomUUID(),
        url: URL.createObjectURL(file),
        file,
        rowId: null,
      }));
      return [...prev, ...added];
    });
  }

  function removePhoto(key: string) {
    setSubmitError(null);
    setPhotos((prev) => {
      const target = prev.find((p) => p.key === key);
      // Only object URLs we minted need revoking; a stored public URL must not be.
      if (target?.file) URL.revokeObjectURL(target.url);
      return prev.filter((p) => p.key !== key);
    });
  }

  function movePhoto(index: number, direction: -1 | 1) {
    setPhotos((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function clearPhotos() {
    setPhotos((prev) => {
      prev.forEach((p) => p.file && URL.revokeObjectURL(p.url));
      return [];
    });
    if (imageInputRef.current) imageInputRef.current.value = "";
  }

  function updateVariant(index: number, field: keyof VariantDraft, value: string) {
    const nextValue = field === "price" ? formatPriceDisplay(value) : value;
    setVariants((prev) => prev.map((v, i) => (i === index ? { ...v, [field]: nextValue } : v)));
  }

  function addVariantRow() {
    setVariants((prev) => [...prev, { id: null, name: "", price: "" }]);
  }

  function removeVariantRow(index: number) {
    setVariants((prev) => prev.filter((_, i) => i !== index));
  }

  /** Uploads anything not yet in Storage; returns every URL in display order. */
  async function uploadPhotos(): Promise<string[]> {
    const urls: string[] = [];
    for (const photo of photos) {
      if (!photo.file) {
        urls.push(photo.url);
        continue;
      }
      const path = `${crypto.randomUUID()}-${photo.file.name}`;
      const { error: uploadError } = await supabase.storage
        .from(IMAGE_BUCKET)
        .upload(path, photo.file, { contentType: photo.file.type });
      if (uploadError) throw new Error("Couldn't upload the product photos.");
      urls.push(supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl);
    }
    return urls;
  }

  function openCreate() {
    setSubmitError(null);
    setEditing(null);
    setActive(true);
    reset({ name: "", description: "" });
    setVariants([{ id: null, name: "", price: "" }]);
    clearPhotos();
    setCreateOpen(true);
  }

  function openEdit(product: ProductRow) {
    setSubmitError(null);
    setEditing(product);
    setActive(product.active);
    reset({ name: product.name, description: product.description ?? "" });
    setVariants(
      product.product_variants.map((v) => ({
        id: v.id,
        name: v.name,
        price: formatPriceDisplay(String(Number(v.price))),
      }))
    );
    clearPhotos();
    setPhotos(
      [...product.product_images]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((image) => ({ key: image.id, url: image.url, file: null, rowId: image.id }))
    );
    setCreateOpen(true);
  }

  /**
   * Product photos are stored as a whole list: the rows are replaced in one go
   * so sort_order always matches what the admin arranged. The Storage objects
   * are deliberately NOT deleted — order_items.image_urls snapshots point at
   * them, and a past order's gallery must not break because a photo was
   * dropped from the product today.
   */
  async function saveEdit(
    product: ProductRow,
    values: ProductValues,
    cleanVariants: Array<{ id: string | null; name: string; price: string }>,
    photoUrls: string[]
  ) {
    const { error: productError } = await supabase
      .from("products")
      .update({
        name: values.name,
        description: values.description || null,
        image_url: photoUrls[0] ?? null,
        active,
      })
      .eq("id", product.id);
    if (productError) throw new Error("Couldn't save the product.");

    const { error: deleteImagesError } = await supabase
      .from("product_images")
      .delete()
      .eq("product_id", product.id);
    if (deleteImagesError) throw new Error("Couldn't update the product photos.");

    if (photoUrls.length > 0) {
      const { error: insertImagesError } = await supabase
        .from("product_images")
        .insert(photoUrls.map((url, i) => ({ product_id: product.id, url, sort_order: i })));
      if (insertImagesError) throw new Error("Couldn't update the product photos.");
    }

    for (const variant of cleanVariants.filter((v) => v.id)) {
      const { error } = await supabase
        .from("product_variants")
        .update({ name: variant.name, price: variant.price })
        .eq("id", variant.id!);
      if (error) throw new Error(`Couldn't save the "${variant.name}" variant.`);
    }

    const added = cleanVariants.filter((v) => !v.id);
    if (added.length > 0) {
      const { data: insertedVariants, error: insertError } = await supabase
        .from("product_variants")
        .insert(added.map((v) => ({ product_id: product.id, name: v.name, price: v.price })))
        .select();
      if (insertError || !insertedVariants) throw new Error("Couldn't add the new variants.");

      const { error: inventoryError } = await supabase
        .from("inventory")
        .insert((insertedVariants as { id: string }[]).map((v) => ({ variant_id: v.id, on_hand: 0, reserved: 0 })));
      if (inventoryError) {
        throw new Error("The new variants were added, but their stock rows failed — check Drizzle Studio.");
      }
    }

    setCreateOpen(false);
    toast.success(`"${values.name}" saved`);
    await loadProducts();
  }

  async function onSubmit(values: ProductValues) {
    setSubmitError(null);

    const cleanVariants = variants
      .map((v) => ({ id: v.id, name: v.name.trim(), price: parsePriceForSubmit(v.price.trim()) }))
      .filter((v) => v.name && v.price);

    if (cleanVariants.length === 0) {
      setSubmitError("Add at least one size/variant with a price.");
      return;
    }
    if (cleanVariants.some((v) => Number.isNaN(Number(v.price)) || Number(v.price) <= 0)) {
      setSubmitError("Every variant needs a valid price.");
      return;
    }

    setSubmitting(true);
    try {
      const photoUrls = await uploadPhotos();

      if (editing) {
        await saveEdit(editing, values, cleanVariants, photoUrls);
        return;
      }

      const { data: product, error: productError } = await supabase
        .from("products")
        .insert({
          name: values.name,
          description: values.description || null,
          // The cover, mirrored so everything already reading image_url keeps working.
          image_url: photoUrls[0] ?? null,
        })
        .select()
        .single();
      if (productError || !product) throw new Error("Couldn't create the product.");

      if (photoUrls.length > 0) {
        const { error: imagesError } = await supabase
          .from("product_images")
          .insert(photoUrls.map((url, i) => ({ product_id: product.id, url, sort_order: i })));
        if (imagesError) {
          throw new Error("Product was created, but saving its photos failed — check Drizzle Studio.");
        }
      }

      const { data: insertedVariants, error: variantError } = await supabase
        .from("product_variants")
        .insert(cleanVariants.map((v) => ({ product_id: product.id, name: v.name, price: v.price })))
        .select();
      if (variantError || !insertedVariants) {
        throw new Error("Product was created, but adding its variants failed — check Drizzle Studio.");
      }

      const { error: inventoryError } = await supabase
        .from("inventory")
        .insert((insertedVariants as { id: string }[]).map((v) => ({ variant_id: v.id, on_hand: 0, reserved: 0 })));
      if (inventoryError) {
        throw new Error("Product and variants were created, but inventory rows failed — check Drizzle Studio.");
      }

      reset();
      setVariants([{ id: null, name: "", price: "" }]);
      clearPhotos();
      setCreateOpen(false);
      toast.success(`"${values.name}" created`);
      await loadProducts();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong creating the product.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AdminLayout>
      <main className="p-4 sm:p-8 max-w-3xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Products</h1>
            <p className="text-muted-foreground mt-1">
              Create products and variants here, independent of any batch. Batches pick from what's created here.
            </p>
          </div>
          <Button
            type="button"
            className="shrink-0"
            disabled={!canManage}
            title={canManage ? undefined : "Requires the Manage products & batches permission"}
            onClick={openCreate}
          >
            <Plus className="size-3.5" />
            New product
          </Button>
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit product" : "New product"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="name">
                  Product name
                  <RequiredMark />
                </Label>
                <Input id="name" aria-invalid={!!errors.name} {...register("name")} placeholder="e.g. Hoodie — Black" />
                {errors.name && <p className="text-destructive text-xs">{errors.name.message}</p>}
                <p className="text-xs text-muted-foreground">
                  Selling this in two colors? Create two separate products (e.g. "Hoodie — Black" and "Hoodie
                  — Navy"), each with its own photos — not a color option on one product.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="description">
                  Description
                  <OptionalMark />
                </Label>
                <Textarea id="description" {...register("description")} rows={2} />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <Label>
                    Photos
                    <OptionalMark />
                  </Label>
                  {photos.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {photos.length} of {MAX_PHOTOS}
                    </span>
                  )}
                </div>

                {photos.length > 0 && (
                  <ul className="grid grid-cols-3 gap-2">
                    {photos.map((photo, i) => (
                      <li
                        key={photo.key}
                        className="relative aspect-square overflow-hidden rounded-md border bg-muted"
                      >
                        <img src={photo.url} alt="" className="h-full w-full object-cover" />

                        <button
                          type="button"
                          onClick={() => removePhoto(photo.key)}
                          title="Remove this photo"
                          className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-background/90 text-destructive transition-colors hover:bg-background"
                        >
                          <X className="size-3.5" />
                          <span className="sr-only">Remove photo {i + 1}</span>
                        </button>

                        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-background/85 px-1 py-1">
                          <div className="flex gap-0.5">
                            <button
                              type="button"
                              disabled={i === 0}
                              onClick={() => movePhoto(i, -1)}
                              title="Move earlier"
                              className="flex size-6 items-center justify-center rounded transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-30"
                            >
                              <ChevronLeft className="size-3.5" />
                              <span className="sr-only">Move photo {i + 1} earlier</span>
                            </button>
                            <button
                              type="button"
                              disabled={i === photos.length - 1}
                              onClick={() => movePhoto(i, 1)}
                              title="Move later"
                              className="flex size-6 items-center justify-center rounded transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-30"
                            >
                              <ChevronRight className="size-3.5" />
                              <span className="sr-only">Move photo {i + 1} later</span>
                            </button>
                          </div>
                          {i === 0 && (
                            <span className="rounded bg-secondary px-1.5 text-[10px] font-semibold leading-5 text-secondary-foreground">
                              Cover
                            </span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {photos.length < MAX_PHOTOS && (
                  <FileInput
                    ref={imageInputRef}
                    multiple
                    accept={ACCEPTED_IMAGE_TYPES.join(",")}
                    onChange={handlePhotoChange}
                    hint={photos.length === 0 ? "JPG, PNG or WebP — pick several at once" : "Add more"}
                  />
                )}

                <p className="text-xs text-muted-foreground">
                  The first photo is the cover — it's what customers see in the list and on their order. Use the
                  arrows to reorder.
                </p>
              </div>

              <div className="space-y-2">
                <Label>
                  Sizes / variants
                  <RequiredMark />
                </Label>
                <p className="text-xs text-muted-foreground">At least one size/variant with a price is required.</p>
                {editing && (
                  <p className="text-xs text-muted-foreground">
                    Existing sizes can be renamed and repriced but not deleted — orders, batches and stock counts
                    point at them. To stop selling one, deactivate the product below.
                  </p>
                )}
                {variants.map((variant, i) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      value={variant.name}
                      onChange={(e) => updateVariant(i, "name", e.target.value)}
                      placeholder="e.g. M"
                      className="w-24"
                    />
                    <Input
                      value={variant.price}
                      onChange={(e) => updateVariant(i, "price", e.target.value)}
                      placeholder="e.g. 150.000"
                      inputMode="decimal"
                      className="flex-1"
                    />
                    {variant.id === null && variants.length > 1 && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => removeVariantRow(i)}
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        title="Remove this size/variant"
                      >
                        <X className="size-4" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button type="button" size="sm" variant="outline" onClick={addVariantRow}>
                  <Plus className="size-3.5" />
                  Add another size
                </Button>
              </div>

              {editing && (
                <label className="flex items-start gap-2.5 rounded-lg border p-3">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(e) => setActive(e.target.checked)}
                    className="mt-0.5 size-4 accent-primary"
                  />
                  <span className="text-sm">
                    <span className="font-medium">Available to order</span>
                    <span className="block text-xs text-muted-foreground">
                      Uncheck to hide it from the storefront. Existing orders are unaffected.
                    </span>
                  </span>
                </label>
              )}

              {submitError && <p className="text-destructive text-sm">{submitError}</p>}

              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={submitting || !canManage} title={canManage ? undefined : "Requires the Manage products & batches permission"}>
                  {submitting ? "Saving…" : editing ? "Save changes" : "Create product"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {loadError && (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <p>{loadError}</p>
            <Button type="button" size="sm" variant="outline" onClick={() => void loadProducts()}>
              <RotateCw className="size-3.5" />
              Retry
            </Button>
          </div>
        )}
        {products === null && !loadError && (
          <Card>
            <CardContent className="space-y-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="h-16 w-16 rounded-lg shrink-0" />
                  <div className="flex-1 space-y-2 pt-1">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {products !== null && (
          <Card>
            <CardHeader>
              <CardTitle>Existing products</CardTitle>
              <CardDescription>{products.length} product{products.length === 1 ? "" : "s"}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {products.length === 0 && <p className="text-muted-foreground text-sm">No products yet.</p>}
              {products.map((product) => (
                <div key={product.id} className="flex gap-3 border-b pb-4 last:border-0 last:pb-0">
                  <div className="relative shrink-0">
                    {product.image_url ? (
                      <img
                        src={product.image_url}
                        alt={product.name}
                        className="h-16 w-16 rounded-lg object-cover border"
                      />
                    ) : (
                      <div className="h-16 w-16 rounded-lg border bg-muted flex items-center justify-center text-xs text-muted-foreground">
                        No photo
                      </div>
                    )}
                    {product.product_images.length > 1 && (
                      <span className="absolute -bottom-1 -right-1 min-w-[18px] rounded-full border-[1.5px] border-card bg-primary px-1 text-center text-[10px] font-bold leading-[15px] text-primary-foreground">
                        {product.product_images.length}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium">
                        {product.name}
                        {!product.active && (
                          <span className="ml-2 rounded-md bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground align-middle">
                            Not for sale
                          </span>
                        )}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        disabled={!canManage}
                        title={canManage ? undefined : "Requires the Manage products & batches permission"}
                        onClick={() => openEdit(product)}
                      >
                        <Pencil className="size-3.5" />
                        Edit
                      </Button>
                    </div>
                    {product.description && <p className="text-sm text-muted-foreground">{product.description}</p>}
                    <div className="mt-1.5 space-y-0.5">
                      {product.product_variants.map((v) => {
                        const stock = product.inventoryByVariant.get(v.id);
                        return (
                          <div key={v.id} className="flex justify-between text-sm">
                            <span>
                              {v.name} — {formatIDR(v.price)}
                            </span>
                            <span className="text-muted-foreground">
                              on hand: {stock?.onHand ?? 0} · reserved: {stock?.reserved ?? 0}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </main>
    </AdminLayout>
  );
}
