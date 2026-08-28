import { useEffect, useState, useCallback, useRef } from "react";
import { X, Plus, RotateCw } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "@/lib/supabaseClient";
import { useAdminAuth } from "@/lib/adminAuth";
import { formatIDR } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label, RequiredMark, OptionalMark } from "@/components/ui/label";
import AdminLayout from "@/components/AdminLayout";

const IMAGE_BUCKET = "product-images";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

const productSchema = z.object({
  name: z.string().trim().min(1, "Product name is required."),
  description: z.string().trim().optional(),
});
type ProductValues = z.infer<typeof productSchema>;

interface VariantDraft {
  name: string;
  price: string;
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
interface RawProductRow {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
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

  const [variants, setVariants] = useState<VariantDraft[]>([{ name: "", price: "" }]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
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
      .select("id, name, description, image_url, product_variants(id, name, price)")
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

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSubmitError(null);
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setSubmitError("Please upload a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setSubmitError("Image is too large — please keep it under 5MB.");
      return;
    }
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    setImageFile(file);
    setImagePreviewUrl(URL.createObjectURL(file));
  }

  function handleRemoveImage() {
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    setImageFile(null);
    setImagePreviewUrl(null);
    if (imageInputRef.current) imageInputRef.current.value = "";
  }

  function updateVariant(index: number, field: keyof VariantDraft, value: string) {
    const nextValue = field === "price" ? formatPriceDisplay(value) : value;
    setVariants((prev) => prev.map((v, i) => (i === index ? { ...v, [field]: nextValue } : v)));
  }

  function addVariantRow() {
    setVariants((prev) => [...prev, { name: "", price: "" }]);
  }

  function removeVariantRow(index: number) {
    setVariants((prev) => prev.filter((_, i) => i !== index));
  }

  async function onSubmit(values: ProductValues) {
    setSubmitError(null);

    const cleanVariants = variants
      .map((v) => ({ name: v.name.trim(), price: parsePriceForSubmit(v.price.trim()) }))
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
      let imageUrl: string | null = null;
      if (imageFile) {
        const path = `${crypto.randomUUID()}-${imageFile.name}`;
        const { error: uploadError } = await supabase.storage
          .from(IMAGE_BUCKET)
          .upload(path, imageFile, { contentType: imageFile.type });
        if (uploadError) throw new Error("Couldn't upload the product image.");
        imageUrl = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
      }

      const { data: product, error: productError } = await supabase
        .from("products")
        .insert({ name: values.name, description: values.description || null, image_url: imageUrl })
        .select()
        .single();
      if (productError || !product) throw new Error("Couldn't create the product.");

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
      setVariants([{ name: "", price: "" }]);
      handleRemoveImage();
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
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Products</h1>
          <p className="text-muted-foreground mt-1">
            Create products and variants here, independent of any batch. Batches pick from what's created here.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>New product</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="name">
                  Product name
                  <RequiredMark />
                </Label>
                <Input id="name" aria-invalid={!!errors.name} {...register("name")} placeholder="e.g. Hoodie — Black" />
                {errors.name && <p className="text-destructive text-xs">{errors.name.message}</p>}
                <p className="text-xs text-muted-foreground">
                  One photo per product. Selling this in two colors? Create two separate products (e.g. "Hoodie
                  — Black" and "Hoodie — Navy"), each with its own photo — not a color option on one product.
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
                <Label>
                  Photo
                  <OptionalMark />
                </Label>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept={ACCEPTED_IMAGE_TYPES.join(",")}
                  onChange={handleImageChange}
                  className="block text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80"
                />
                {imagePreviewUrl && (
                  <div className="flex items-center gap-3 pt-1">
                    <img src={imagePreviewUrl} alt="Preview" className="h-24 w-24 rounded-lg object-cover border" />
                    <Button type="button" size="sm" variant="outline" onClick={handleRemoveImage} className="text-destructive hover:text-destructive">
                      <X className="size-3.5" />
                      Remove
                    </Button>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label>
                  Sizes / variants
                  <RequiredMark />
                </Label>
                <p className="text-xs text-muted-foreground">At least one size/variant with a price is required.</p>
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
                    {variants.length > 1 && (
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

              {submitError && <p className="text-destructive text-sm">{submitError}</p>}

              <Button type="submit" disabled={submitting || !canManage} title={canManage ? undefined : "Requires the Manage products & batches permission"}>
                {submitting ? "Creating…" : "Create product"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {loadError && (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <p>{loadError}</p>
            <Button type="button" size="sm" variant="outline" onClick={() => void loadProducts()}>
              <RotateCw className="size-3.5" />
              Retry
            </Button>
          </div>
        )}
        {products === null && !loadError && <p className="text-muted-foreground text-sm">Loading products…</p>}

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
                  {product.image_url ? (
                    <img
                      src={product.image_url}
                      alt={product.name}
                      className="h-16 w-16 rounded-lg object-cover border shrink-0"
                    />
                  ) : (
                    <div className="h-16 w-16 rounded-lg border bg-muted flex items-center justify-center text-xs text-muted-foreground shrink-0">
                      No photo
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{product.name}</p>
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
