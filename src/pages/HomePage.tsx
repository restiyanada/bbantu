import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Search, Plus, Minus, Check, ChevronRight, Image as ImageIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "@/lib/supabaseClient";
import { formatIDR } from "@/lib/utils";
import { ACCEPTED_IMAGE_TYPES } from "@/lib/fileUpload";
import { useProofUpload } from "@/lib/useProofUpload";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileUploadPreview } from "@/components/ui/file-upload-preview";
import { ProductDetailSheet } from "@/components/product-detail-sheet";
import { FileInput } from "@/components/ui/file-input";
import { Input, Textarea, Select } from "@/components/ui/input";
import { Label, RequiredMark } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface VariantRow {
  id: string;
  name: string;
  price: string;
}

interface ProductImageRow {
  url: string;
  sort_order: number;
}
interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  product_images: ProductImageRow[];
  product_variants: VariantRow[];
}

/** sort_order is the admin's arrangement; image_url is the cover fallback. */
function photoUrlsOf(product: { image_url: string | null; product_images?: ProductImageRow[] }): string[] {
  const ordered = [...(product.product_images ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  if (ordered.length > 0) return ordered.map((i) => i.url);
  return product.image_url ? [product.image_url] : [];
}

interface PaymentSettingsRow {
  bank_name: string;
  account_number: string;
  account_holder_name: string;
}

interface RawBatchItem {
  id: string;
  variant_id: string;
  product_variants: {
    name: string;
    price: string;
    products: {
      name: string;
      description: string | null;
      image_url: string | null;
      product_images: ProductImageRow[];
    } | null;
  };
}
interface RawBatch {
  id: string;
  name: string;
  allowed_payment_types: string[];
  allowed_fulfilment_methods: string[];
}

interface SelectableItem {
  variantId: string;
  productName: string;
  variantName: string;
  label: string;
  price: string;
  description: string | null;
  photoUrls: string[];
}

interface BatchOption {
  id: string;
  name: string;
  allowedPaymentTypes: string[];
  allowedFulfilmentMethods: string[];
  items: SelectableItem[];
}

interface LocationOption {
  code: string;
  name: string;
}
interface JneRateOption {
  serviceCode: string;
  serviceName: string;
  etd: string | null;
  price: number;
}

const NAME_PATTERN = /^[\p{L}\s'-]+$/u;
const PHONE_PATTERN = /^[0-9]{8,15}$/;

const customerSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").regex(NAME_PATTERN, "Name can only contain letters."),
  phone: z.string().trim().regex(PHONE_PATTERN, "Phone number must be 8–15 digits, numbers only."),
  email: z.string().trim().email("A valid email is required."),
});

type CustomerValues = z.infer<typeof customerSchema>;

const STEPS = ["Choose items", "Your details", "Review & pay"] as const;

export default function HomePage() {
  const navigate = useNavigate();
  const [products, setProducts] = useState<ProductRow[] | null>(null);
  const [batches, setBatches] = useState<BatchOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [step, setStep] = useState(1);

  const [activeSource, setActiveSource] = useState<string>("READY_STOCK");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [paymentType, setPaymentType] = useState<"DP" | "FULL">("FULL");

  const [paymentSettings, setPaymentSettings] = useState<PaymentSettingsRow | null>(null);

  const [fulfilmentMethod, setFulfilmentMethod] = useState<"PICKUP" | "SHIPPING">("PICKUP");
  const [provinces, setProvinces] = useState<LocationOption[] | null>(null);
  const [cities, setCities] = useState<LocationOption[] | null>(null);
  const [districts, setDistricts] = useState<LocationOption[] | null>(null);
  const [selectedProvinceCode, setSelectedProvinceCode] = useState("");
  const [selectedCityCode, setSelectedCityCode] = useState("");
  const [selectedDistrict, setSelectedDistrict] = useState<LocationOption | null>(null);
  const [addressDetail, setAddressDetail] = useState("");
  const [locationError, setLocationError] = useState<string | null>(null);

  const [rates, setRates] = useState<JneRateOption[] | null>(null);
  const [selectedServiceCode, setSelectedServiceCode] = useState<string | null>(null);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);

  const [submissionToken, setSubmissionToken] = useState(() => crypto.randomUUID());
  const proof = useProofUpload(submissionToken);

  const {
    register,
    handleSubmit,
    watch,
    trigger,
    formState: { errors, isSubmitting },
  } = useForm<CustomerValues>({ resolver: zodResolver(customerSchema) });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [productsResult, batchesResult, settingsResult] = await Promise.all([
        supabase
          .from("products")
          .select(
            "id, name, description, image_url, product_images(url, sort_order), product_variants(id, name, price)"
          )
          .eq("active", true),
        supabase
          .from("batches")
          .select(
            "id, name, allowed_payment_types, allowed_fulfilment_methods, batch_items(id, variant_id, product_variants(name, price, products(name, description, image_url, product_images(url, sort_order))))"
          )
          .eq("status", "OPEN"),
        supabase.from("payment_settings").select("bank_name, account_number, account_holder_name").limit(1).maybeSingle(),
      ]);

      if (cancelled) return;

      if (productsResult.error) {
        setLoadError("Couldn't load products right now. Please try again shortly.");
      } else {
        setProducts((productsResult.data as ProductRow[] | null) ?? []);
      }

      const rawBatches = ((batchesResult.data as unknown) as
        | (RawBatch & { batch_items: RawBatchItem[] })[]
        | null) ?? [];
      setBatches(
        rawBatches.map((b) => ({
          id: b.id,
          name: b.name,
          allowedPaymentTypes: b.allowed_payment_types,
          allowedFulfilmentMethods: b.allowed_fulfilment_methods,
          items: b.batch_items.map((item) => {
            const product = item.product_variants.products;
            return {
              variantId: item.variant_id,
              productName: product?.name ?? "Product",
              variantName: item.product_variants.name,
              label: `${product?.name ?? "Product"} — ${item.product_variants.name}`,
              price: item.product_variants.price,
              description: product?.description ?? null,
              photoUrls: product ? photoUrlsOf(product) : [],
            };
          }),
        }))
      );

      setPaymentSettings((settingsResult.data as PaymentSettingsRow | null) ?? null);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadProvinces() {
      const { data, error } = await supabase.functions.invoke("shipping-locations", { body: { level: "provinces" } });
      if (cancelled) return;
      if (error || !data) {
        setLocationError("Couldn't load shipping locations. Shipping may be unavailable right now.");
        return;
      }
      setProvinces(data.items as LocationOption[]);
    }
    void loadProvinces();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleProvinceChange(code: string) {
    setSelectedProvinceCode(code);
    setSelectedCityCode("");
    setSelectedDistrict(null);
    setCities(null);
    setDistricts(null);
    setRates(null);
    setSelectedServiceCode(null);
    if (!code) return;

    const { data, error } = await supabase.functions.invoke("shipping-locations", {
      body: { level: "cities", provinceCode: code },
    });
    if (error || !data) {
      setLocationError("Couldn't load cities for that province.");
      return;
    }
    setLocationError(null);
    setCities(data.items as LocationOption[]);
  }

  async function handleCityChange(code: string) {
    setSelectedCityCode(code);
    setSelectedDistrict(null);
    setDistricts(null);
    setRates(null);
    setSelectedServiceCode(null);
    if (!code) return;

    const { data, error } = await supabase.functions.invoke("shipping-locations", {
      body: { level: "districts", cityCode: code },
    });
    if (error || !data) {
      setLocationError("Couldn't load districts for that city.");
      return;
    }
    setLocationError(null);
    setDistricts(data.items as LocationOption[]);
  }

  function handleDistrictChange(code: string) {
    const district = districts?.find((d) => d.code === code) ?? null;
    setSelectedDistrict(district);
    setRates(null);
    setSelectedServiceCode(null);
  }

  async function handleGetRate() {
    if (!selectedDistrict) return;
    const items = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([variantId, quantity]) => ({ variantId, quantity }));
    if (items.length === 0) {
      setRateError("Add at least one item before getting a shipping rate.");
      return;
    }

    setRateLoading(true);
    setRateError(null);
    setRates(null);
    setSelectedServiceCode(null);

    const { data, error } = await supabase.functions.invoke("shipping-rates", {
      body: { destinationDistrictCode: selectedDistrict.code, items },
    });

    setRateLoading(false);

    if (error || !data) {
      setRateError(
        (data as { error?: string } | null)?.error ?? "Couldn't get a shipping rate right now. Please try again."
      );
      return;
    }

    const fetchedRates = data.rates as JneRateOption[];
    if (fetchedRates.length === 0) {
      setRateError("JNE doesn't appear to deliver to that address — please double-check the district, or choose pickup instead.");
      return;
    }

    setRates(fetchedRates);
    setSelectedServiceCode(fetchedRates[0].serviceCode);
  }

  const activeBatch = activeSource === "READY_STOCK" ? null : batches?.find((b) => b.id === activeSource) ?? null;

  const shippingAllowed = activeBatch ? activeBatch.allowedFulfilmentMethods.includes("SHIPPING") : true;

  const activeItems: SelectableItem[] =
    activeSource === "READY_STOCK"
      ? (products ?? []).flatMap((p) =>
          p.product_variants.map((v) => ({
            variantId: v.id,
            productName: p.name,
            variantName: v.name,
            label: `${p.name} — ${v.name}`,
            price: v.price,
            description: p.description,
            photoUrls: photoUrlsOf(p),
          }))
        )
      : activeBatch?.items ?? [];

  function handleSourceChange(source: string) {
    setActiveSource(source);
    setQuantities({});
    setItemsError(null);
    setPaymentType("FULL");
    setFulfilmentMethod("PICKUP");
    setRates(null);
    setSelectedServiceCode(null);
    setRateError(null);
  }

  function setQuantity(variantId: string, qty: number) {
    setQuantities((prev) => ({ ...prev, [variantId]: Math.max(0, qty) }));
  }

  const subtotalCents = activeItems.reduce(
    (sum, item) => sum + (quantities[item.variantId] ?? 0) * Math.round(Number(item.price) * 100),
    0
  );
  const hasItems = subtotalCents > 0;
  const cartCount = activeItems.reduce((sum, item) => sum + (quantities[item.variantId] ?? 0), 0);
  const subtotal = (subtotalCents / 100).toFixed(2);

  const isPreOrder = activeSource !== "READY_STOCK";
  const effectivePaymentType = isPreOrder ? paymentType : "FULL";
  const depositCents = Math.round(subtotalCents * 0.5);

  const selectedRate = rates?.find((r) => r.serviceCode === selectedServiceCode) ?? null;
  const shippingCostCents = fulfilmentMethod === "SHIPPING" && selectedRate ? Math.round(selectedRate.price * 100) : 0;

  const amountDueNowCents = (effectivePaymentType === "DP" ? depositCents : subtotalCents) + shippingCostCents;
  const grandTotalCents = subtotalCents + shippingCostCents;

  function handleContinueFromItems() {
    if (!hasItems) {
      setItemsError("Add at least one item before continuing.");
      return;
    }
    setItemsError(null);
    setStep(2);
  }

  async function handleContinueFromDetails() {
    setDetailsError(null);
    const valid = await trigger(["name", "phone", "email"]);
    if (!valid) return;

    if (fulfilmentMethod === "SHIPPING") {
      if (!selectedDistrict || !addressDetail.trim()) {
        setDetailsError("Please complete the delivery address.");
        return;
      }
      if (!selectedServiceCode) {
        setDetailsError("Please get a shipping rate and pick an option before continuing.");
        return;
      }
    }
    setStep(3);
  }

  async function onSubmit(customer: CustomerValues) {
    setSubmitError(null);

    const items = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([variantId, quantity]) => ({ variantId, quantity }));

    if (items.length === 0) {
      setItemsError("Add at least one item before placing your order.");
      setStep(1);
      return;
    }
    if (!proof.path) {
      proof.setError("Please upload your payment proof before submitting.");
      return;
    }

    if (fulfilmentMethod === "SHIPPING") {
      if (!selectedDistrict || !addressDetail.trim() || !selectedServiceCode) {
        setSubmitError("Please complete the delivery address and shipping option.");
        setStep(2);
        return;
      }
    }

    const { data, error } = await supabase.functions.invoke("create-order", {
      body: {
        customer,
        items,
        submissionToken,
        proofFileUrl: proof.path,
        fulfilmentMethod,
        ...(isPreOrder ? { batchId: activeSource, paymentType: effectivePaymentType } : {}),
        ...(fulfilmentMethod === "SHIPPING"
          ? {
              shipping: {
                recipientName: customer.name,
                recipientPhone: customer.phone,
                address: addressDetail.trim(),
                destinationDistrictCode: selectedDistrict!.code,
                destinationDistrictName: selectedDistrict!.name,
                serviceCode: selectedServiceCode,
              },
            }
          : {}),
      },
    });

    if (error || !data) {
      setSubmitError(
        (data as { error?: string } | null)?.error ?? "Something went wrong placing your order. Please try again."
      );
      setSubmissionToken(crypto.randomUUID());
      proof.reset();
      return;
    }

    navigate(`/orders/${data.accessToken}`);
  }

  return (
    <main className="p-4 sm:p-8 max-w-3xl mx-auto space-y-6 pb-28">
      <div className="space-y-1.5">
        <h1 className="text-4xl font-bold tracking-tight">[Your shop name]</h1>
        <p className="text-muted-foreground">Pick an item, enter your details, and place your order.</p>
        <Button asChild size="sm" variant="outline" className="mt-1">
          <Link to="/orders/find">
            <Search className="size-3.5" />
            Find my order
          </Link>
        </Button>
      </div>

      {/* Progress indicator */}
      <div className="flex items-center">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const state = n < step ? "done" : n === step ? "active" : "upcoming";
          return (
            <div key={label} className="flex items-center flex-1 last:flex-none">
              <button
                type="button"
                disabled={n > step}
                onClick={() => n < step && setStep(n)}
                className={cn(
                  "flex items-center gap-2 shrink-0",
                  n < step ? "cursor-pointer" : "cursor-default"
                )}
              >
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                    state === "done" && "border-primary bg-primary text-primary-foreground",
                    state === "active" && "border-primary text-primary",
                    state === "upcoming" && "border-border text-muted-foreground"
                  )}
                >
                  {state === "done" ? <Check className="size-3.5" /> : n}
                </span>
                <span
                  className={cn(
                    "text-sm hidden sm:inline",
                    state === "active" ? "font-semibold" : "text-muted-foreground"
                  )}
                >
                  {label}
                </span>
              </button>
              {n < STEPS.length && (
                <span className={cn("h-px flex-1 mx-2", n < step ? "bg-primary" : "bg-border")} />
              )}
            </div>
          );
        })}
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* STEP 1: choose items */}
        {step === 1 && (
          <>
            {batches !== null && batches.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => handleSourceChange("READY_STOCK")}
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
                    onClick={() => handleSourceChange(b.id)}
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
                            setDetail({
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
                                onChange={(qty) => setQuantity(variant.id, qty)}
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
                                setDetail({
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
                                onChange={(qty) => setQuantity(item.variantId, qty)}
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
                              onChange={() => setPaymentType("FULL")}
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
                              onChange={() => setPaymentType("DP")}
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
        )}

        {/* STEP 2: details & fulfilment */}
        {step === 2 && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Your details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="name">
                    Name
                    <RequiredMark />
                  </Label>
                  <Input id="name" aria-invalid={!!errors.name} {...register("name")} />
                  {errors.name && <p className="text-destructive text-xs">{errors.name.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">
                    Phone number
                    <RequiredMark />
                  </Label>
                  <Input id="phone" aria-invalid={!!errors.phone} {...register("phone")} />
                  {errors.phone && <p className="text-destructive text-xs">{errors.phone.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">
                    Email
                    <RequiredMark />
                  </Label>
                  <Input id="email" type="email" aria-invalid={!!errors.email} {...register("email")} />
                  {errors.email && <p className="text-destructive text-xs">{errors.email.message}</p>}
                </div>
              </CardContent>
            </Card>

            {shippingAllowed && (
              <Card>
                <CardHeader>
                  <CardTitle>Fulfilment</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-1.5">
                      <input
                        type="radio"
                        checked={fulfilmentMethod === "PICKUP"}
                        onChange={() => setFulfilmentMethod("PICKUP")}
                        className="accent-primary"
                      />
                      Booth pickup
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input
                        type="radio"
                        checked={fulfilmentMethod === "SHIPPING"}
                        onChange={() => setFulfilmentMethod("SHIPPING")}
                        className="accent-primary"
                      />
                      Shipping (JNE)
                    </label>
                  </div>

                  {fulfilmentMethod === "SHIPPING" && (
                    <div className="space-y-3 pt-3 border-t">
                      {locationError && <p className="text-destructive text-xs">{locationError}</p>}

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            Province
                            <RequiredMark />
                          </Label>
                          <Select
                            value={selectedProvinceCode}
                            onChange={(e) => void handleProvinceChange(e.target.value)}
                            className="h-8 text-sm"
                          >
                            <option value="">
                              {provinces === null ? "Loading…" : "Select province"}
                            </option>
                            {provinces?.map((p) => (
                              <option key={p.code} value={p.code}>
                                {p.name}
                              </option>
                            ))}
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            City / Regency
                            <RequiredMark />
                          </Label>
                          <Select
                            value={selectedCityCode}
                            onChange={(e) => void handleCityChange(e.target.value)}
                            disabled={!selectedProvinceCode}
                            className="h-8 text-sm"
                          >
                            <option value="">{cities === null ? "—" : "Select city"}</option>
                            {cities?.map((c) => (
                              <option key={c.code} value={c.code}>
                                {c.name}
                              </option>
                            ))}
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            District
                            <RequiredMark />
                          </Label>
                          <Select
                            value={selectedDistrict?.code ?? ""}
                            onChange={(e) => handleDistrictChange(e.target.value)}
                            disabled={!selectedCityCode}
                            className="h-8 text-sm"
                          >
                            <option value="">{districts === null ? "—" : "Select district"}</option>
                            {districts?.map((d) => (
                              <option key={d.code} value={d.code}>
                                {d.name}
                              </option>
                            ))}
                          </Select>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">
                          Street address, RT/RW, landmark, etc.
                          <RequiredMark />
                        </Label>
                        <Textarea
                          value={addressDetail}
                          onChange={(e) => setAddressDetail(e.target.value)}
                          rows={2}
                          className="text-sm"
                        />
                      </div>

                      <p className="text-xs text-muted-foreground">
                        Shipping to <span className="font-medium text-foreground">{watch("name") || "—"}</span> ·{" "}
                        {watch("phone") || "—"}
                      </p>

                      <Button
                        type="button"
                        variant="info"
                        size="sm"
                        disabled={!selectedDistrict || rateLoading}
                        onClick={() => void handleGetRate()}
                      >
                        {rateLoading ? "Getting rate…" : "Get shipping rate"}
                      </Button>
                      {rateError && <p className="text-destructive text-xs">{rateError}</p>}

                      {rates && rates.length > 0 && (
                        <div className="space-y-1.5 pt-1">
                          {rates.map((rate) => (
                            <label
                              key={rate.serviceCode}
                              className={cn(
                                "flex items-center justify-between rounded-lg border px-3 py-2 cursor-pointer transition-colors",
                                selectedServiceCode === rate.serviceCode
                                  ? "border-primary bg-accent"
                                  : "hover:bg-muted"
                              )}
                            >
                              <span className="flex items-center gap-2">
                                <input
                                  type="radio"
                                  checked={selectedServiceCode === rate.serviceCode}
                                  onChange={() => setSelectedServiceCode(rate.serviceCode)}
                                  className="accent-primary"
                                />
                                JNE {rate.serviceName}
                                {rate.etd && <span className="text-muted-foreground"> · {rate.etd} days</span>}
                              </span>
                              <span className="font-medium">{formatIDR(rate.price)}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {detailsError && <p className="text-destructive text-sm">{detailsError}</p>}
          </>
        )}

        {/* STEP 3: review & pay */}
        {step === 3 && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Order summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="space-y-1.5">
                  {activeItems
                    .filter((item) => (quantities[item.variantId] ?? 0) > 0)
                    .map((item) => (
                      <div key={item.variantId} className="flex justify-between gap-2">
                        <span className="text-muted-foreground">
                          {item.label} × {quantities[item.variantId]}
                        </span>
                        <span>{formatIDR((Number(item.price) * quantities[item.variantId]).toFixed(2))}</span>
                      </div>
                    ))}
                </div>
                <div className="flex justify-between pt-1 border-t">
                  <span>Merchandise subtotal</span>
                  <span className="font-medium">{formatIDR(subtotal)}</span>
                </div>
                {fulfilmentMethod === "SHIPPING" && selectedRate && (
                  <div className="flex justify-between">
                    <span>Shipping (JNE {selectedRate.serviceName})</span>
                    <span className="font-medium">{formatIDR(selectedRate.price)}</span>
                  </div>
                )}
                <div className="flex justify-between font-medium pt-1 border-t">
                  <span>Order total</span>
                  <span>{formatIDR((grandTotalCents / 100).toFixed(2))}</span>
                </div>

                {effectivePaymentType === "DP" ? (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 p-3.5 space-y-1">
                    <p className="font-medium text-amber-900">This is a deposit (DP) order.</p>
                    <div className="flex justify-between text-amber-900">
                      <span>Merchandise deposit (50%)</span>
                      <span>{formatIDR((depositCents / 100).toFixed(2))}</span>
                    </div>
                    {fulfilmentMethod === "SHIPPING" && selectedRate && (
                      <div className="flex justify-between text-amber-900">
                        <span>Shipping (paid in full now)</span>
                        <span>{formatIDR(selectedRate.price)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-amber-900 font-semibold pt-1 border-t border-amber-200">
                      <span>Pay now</span>
                      <span>{formatIDR((amountDueNowCents / 100).toFixed(2))}</span>
                    </div>
                    <div className="flex justify-between text-amber-800">
                      <span>Remaining merchandise balance (due later, once ready)</span>
                      <span>{formatIDR(((subtotalCents - depositCents) / 100).toFixed(2))}</span>
                    </div>
                    <p className="text-xs text-amber-700 pt-1">
                      You'll be notified when the remaining balance is due — you don't need to pay it now.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-lg bg-blue-50 border border-blue-200 p-3.5">
                    <p className="font-medium text-blue-900">You're paying the full amount now.</p>
                    <div className="flex justify-between text-blue-900 mt-1">
                      <span>Amount to transfer</span>
                      <span className="font-semibold">{formatIDR((amountDueNowCents / 100).toFixed(2))}</span>
                    </div>
                  </div>
                )}

                {paymentSettings ? (
                  <div className="pt-2 mt-2 border-t space-y-1">
                    <p className="text-muted-foreground">Transfer to:</p>
                    <p>
                      <span className="font-medium">{paymentSettings.bank_name}</span> —{" "}
                      {paymentSettings.account_number}
                    </p>
                    <p className="text-muted-foreground">a.n. {paymentSettings.account_holder_name}</p>
                  </div>
                ) : (
                  <p className="text-muted-foreground pt-2 mt-2 border-t">
                    Bank account details aren't configured yet — contact us before paying.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  Payment proof <span className="text-destructive text-sm font-normal">*</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Upload a screenshot of your transfer receipt for the amount shown above.
                </p>
                <FileInput
                  ref={proof.inputRef}
                  accept={ACCEPTED_IMAGE_TYPES.join(",")}
                  onChange={proof.handleFileChange}
                  disabled={proof.uploading}
                  hint="JPG, PNG or WebP"
                />
                {proof.uploading && <p className="text-sm text-muted-foreground">Uploading…</p>}
                {proof.path && proof.previewUrl && !proof.uploading && (
                  <FileUploadPreview previewUrl={proof.previewUrl} label={proof.fileName ?? "Uploaded"} onRemove={proof.reset} />
                )}
                {proof.error && <p className="text-destructive text-sm">{proof.error}</p>}
              </CardContent>
            </Card>

            {submitError && <p className="text-destructive text-sm">{submitError}</p>}
          </>
        )}

        <ProductDetailSheet
          open={detail !== null}
          onOpenChange={(open) => !open && setDetail(null)}
          name={detail?.name ?? ""}
          description={detail?.description}
          photoUrls={detail?.photoUrls ?? []}
        >
          <div className="space-y-2.5">
            {(detail?.rows ?? []).map((row) => (
              <QuantityRow
                key={row.variantId}
                label={row.label}
                qty={quantities[row.variantId] ?? 0}
                onChange={(qty) => setQuantity(row.variantId, qty)}
              />
            ))}
          </div>
        </ProductDetailSheet>

        {/* Sticky step navigation / cart bar */}
        <div className="fixed bottom-0 inset-x-0 bg-card border-t z-20">
          <div className="max-w-3xl mx-auto px-4 sm:px-8 py-3 flex items-center justify-between gap-3">
            {step === 1 ? (
              <div>
                <p className="text-xs text-muted-foreground">{cartCount} item(s)</p>
                <p className="text-base font-bold">{formatIDR(subtotal)}</p>
              </div>
            ) : (
              <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
                Back
              </Button>
            )}

            {step === 1 && (
              <Button type="button" onClick={handleContinueFromItems} disabled={!hasItems}>
                Continue
              </Button>
            )}
            {step === 2 && (
              <Button type="button" onClick={() => void handleContinueFromDetails()}>
                Continue
              </Button>
            )}
            {step === 3 && (
              <Button
                type="submit"
                disabled={
                  isSubmitting ||
                  !proof.path ||
                  proof.uploading ||
                  (fulfilmentMethod === "SHIPPING" && !selectedServiceCode)
                }
              >
                {isSubmitting ? "Placing order…" : "Place order"}
              </Button>
            )}
          </div>
        </div>
      </form>
    </main>
  );
}

interface DetailTarget {
  name: string;
  description: string | null;
  photoUrls: string[];
  rows: Array<{ variantId: string; label: string }>;
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

function QuantityRow({ label, qty, onChange }: { label?: string; qty: number; onChange: (qty: number) => void }) {
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
