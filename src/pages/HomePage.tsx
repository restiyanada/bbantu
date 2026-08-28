import { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Search } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "@/lib/supabaseClient";
import { formatIDR } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileUploadPreview } from "@/components/ui/file-upload-preview";
import { Input, Textarea, Select } from "@/components/ui/input";
import { Label, RequiredMark } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface VariantRow {
  id: string;
  name: string;
  price: string;
}

interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  product_variants: VariantRow[];
}

interface PaymentSettingsRow {
  bank_name: string;
  account_number: string;
  account_holder_name: string;
}

interface RawBatchItem {
  id: string;
  variant_id: string;
  product_variants: { name: string; price: string; products: { name: string; image_url: string | null } | null };
}
interface RawBatch {
  id: string;
  name: string;
  allowed_payment_types: string[];
  allowed_fulfilment_methods: string[];
}

interface SelectableItem {
  variantId: string;
  label: string;
  price: string;
  imageUrl: string | null;
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

const PROOF_BUCKET = "payment-proofs";
const MAX_PROOF_BYTES = 5 * 1024 * 1024;
const ACCEPTED_PROOF_TYPES = ["image/jpeg", "image/png", "image/webp"];

const NAME_PATTERN = /^[\p{L}\s'-]+$/u;
const PHONE_PATTERN = /^[0-9]{8,15}$/;

const customerSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").regex(NAME_PATTERN, "Name can only contain letters."),
  phone: z.string().trim().regex(PHONE_PATTERN, "Phone number must be 8–15 digits, numbers only."),
  email: z.string().trim().email("A valid email is required."),
});

type CustomerValues = z.infer<typeof customerSchema>;

export default function HomePage() {
  const navigate = useNavigate();
  const [products, setProducts] = useState<ProductRow[] | null>(null);
  const [batches, setBatches] = useState<BatchOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeSource, setActiveSource] = useState<string>("READY_STOCK");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [itemsError, setItemsError] = useState<string | null>(null);
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

  const [proofPath, setProofPath] = useState<string | null>(null);
  const [proofFileName, setProofFileName] = useState<string | null>(null);
  const [proofPreviewUrl, setProofPreviewUrl] = useState<string | null>(null);
  const [proofUploading, setProofUploading] = useState(false);
  const [proofError, setProofError] = useState<string | null>(null);
  const proofInputRef = useRef<HTMLInputElement>(null);

  const [submissionToken, setSubmissionToken] = useState(() => crypto.randomUUID());

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CustomerValues>({ resolver: zodResolver(customerSchema) });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [productsResult, batchesResult, settingsResult] = await Promise.all([
        supabase
          .from("products")
          .select("id, name, description, image_url, product_variants(id, name, price)")
          .eq("active", true),
        supabase
          .from("batches")
          .select(
            "id, name, allowed_payment_types, allowed_fulfilment_methods, batch_items(id, variant_id, product_variants(name, price, products(name, image_url)))"
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
          items: b.batch_items.map((item) => ({
            variantId: item.variant_id,
            label: `${item.product_variants.products?.name ?? "Product"} — ${item.product_variants.name}`,
            price: item.product_variants.price,
            imageUrl: item.product_variants.products?.image_url ?? null,
          })),
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
            label: `${p.name} — ${v.name}`,
            price: v.price,
            imageUrl: p.image_url,
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

  const subtotalCents = activeItems.reduce(
    (sum, item) => sum + (quantities[item.variantId] ?? 0) * Math.round(Number(item.price) * 100),
    0
  );
  const hasItems = subtotalCents > 0;
  const subtotal = (subtotalCents / 100).toFixed(2);

  const isPreOrder = activeSource !== "READY_STOCK";
  const effectivePaymentType = isPreOrder ? paymentType : "FULL";
  const depositCents = Math.round(subtotalCents * 0.5);

  const selectedRate = rates?.find((r) => r.serviceCode === selectedServiceCode) ?? null;
  const shippingCostCents = fulfilmentMethod === "SHIPPING" && selectedRate ? Math.round(selectedRate.price * 100) : 0;

  const amountDueNowCents = (effectivePaymentType === "DP" ? depositCents : subtotalCents) + shippingCostCents;
  const grandTotalCents = subtotalCents + shippingCostCents;

  async function handleProofFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setProofError(null);
    setProofPath(null);

    if (!ACCEPTED_PROOF_TYPES.includes(file.type)) {
      setProofError("Please upload a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > MAX_PROOF_BYTES) {
      setProofError("File is too large — please keep it under 5MB.");
      return;
    }

    setProofPreviewUrl(URL.createObjectURL(file));
    setProofUploading(true);
    const path = `${submissionToken}/${crypto.randomUUID()}-${file.name}`;
    const { error } = await supabase.storage.from(PROOF_BUCKET).upload(path, file, { contentType: file.type });
    setProofUploading(false);

    if (error) {
      setProofError("Couldn't upload your payment proof. Please try again.");
      return;
    }
    setProofPath(path);
    setProofFileName(file.name);
  }

  function handleRemoveProof() {
    if (proofPreviewUrl) URL.revokeObjectURL(proofPreviewUrl);
    setProofPath(null);
    setProofFileName(null);
    setProofPreviewUrl(null);
    setProofError(null);
    if (proofInputRef.current) proofInputRef.current.value = "";
  }

  async function onSubmit(customer: CustomerValues) {
    setSubmitError(null);
    setItemsError(null);

    const items = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([variantId, quantity]) => ({ variantId, quantity }));

    if (items.length === 0) {
      setItemsError("Add at least one item before placing your order.");
      return;
    }
    if (!proofPath) {
      setProofError("Please upload your payment proof before submitting.");
      return;
    }

    if (fulfilmentMethod === "SHIPPING") {
      if (!selectedDistrict || !addressDetail.trim()) {
        setSubmitError("Please complete the delivery address.");
        return;
      }
      if (!selectedServiceCode) {
        setSubmitError("Please get a shipping rate and pick an option before submitting.");
        return;
      }
    }

    const { data, error } = await supabase.functions.invoke("create-order", {
      body: {
        customer,
        items,
        submissionToken,
        proofFileUrl: proofPath,
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
      setProofPath(null);
      setProofFileName(null);
      return;
    }

    navigate(`/orders/${data.accessToken}`);
  }

  return (
    <main className="p-4 sm:p-8 max-w-2xl mx-auto space-y-8">
      <div className="space-y-1.5">
        <h1 className="text-3xl font-bold tracking-tight">Pre-Order &amp; Ready Stock System</h1>
        <p className="text-muted-foreground">Pick an item, enter your details, and place your order.</p>
        <Button asChild size="sm" variant="outline" className="mt-1">
          <Link to="/orders/find">
            <Search className="size-3.5" />
            Find my order
          </Link>
        </Button>
      </div>

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
          {!loadError && products === null && <p className="text-muted-foreground text-sm">Loading items…</p>}
          {activeSource === "READY_STOCK" && products !== null && products.length === 0 && (
            <p className="text-muted-foreground text-sm">Nothing available to order right now.</p>
          )}

          {activeSource === "READY_STOCK" &&
            products?.map((product) => (
              <div key={product.id} className="space-y-2 pb-4 border-b last:border-0 last:pb-0">
                <div className="flex items-center gap-3">
                  {product.image_url ? (
                    <img src={product.image_url} alt="" className="h-12 w-12 rounded-lg object-cover border shrink-0" />
                  ) : (
                    <span className="h-12 w-12 rounded-lg border bg-muted shrink-0" />
                  )}
                  <div>
                    <p className="font-medium">{product.name}</p>
                    {product.description && <p className="text-sm text-muted-foreground">{product.description}</p>}
                  </div>
                </div>
                {product.product_variants.map((variant) => (
                  <div key={variant.id} className="flex items-center justify-between text-sm pl-3">
                    <span>
                      {variant.name} — {formatIDR(variant.price)}
                    </span>
                    <Input
                      type="number"
                      min={0}
                      value={quantities[variant.id] ?? 0}
                      onChange={(e) =>
                        setQuantities((prev) => ({
                          ...prev,
                          [variant.id]: Math.max(0, Number(e.target.value) || 0),
                        }))
                      }
                      className="w-16 h-8 text-right"
                    />
                  </div>
                ))}
              </div>
            ))}

          {activeBatch && (
            <div className="space-y-2">
              {activeBatch.items.length === 0 && (
                <p className="text-muted-foreground text-sm">This batch has no items yet.</p>
              )}
              {activeBatch.items.map((item) => (
                <div key={item.variantId} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt="" className="h-8 w-8 rounded-lg object-cover border shrink-0" />
                    ) : (
                      <span className="h-8 w-8 rounded-lg border bg-muted shrink-0" />
                    )}
                    {item.label} — {formatIDR(item.price)}
                  </span>
                  <Input
                    type="number"
                    min={0}
                    value={quantities[item.variantId] ?? 0}
                    onChange={(e) =>
                      setQuantities((prev) => ({
                        ...prev,
                        [item.variantId]: Math.max(0, Number(e.target.value) || 0),
                      }))
                    }
                    className="w-16 h-8 text-right"
                  />
                </div>
              ))}
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

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
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

        {hasItems && shippingAllowed && (
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

        {hasItems && (
          <Card>
            <CardHeader>
              <CardTitle>Order summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
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
        )}

        {hasItems && (
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
              <input
                ref={proofInputRef}
                type="file"
                accept={ACCEPTED_PROOF_TYPES.join(",")}
                onChange={handleProofFileChange}
                disabled={proofUploading}
                className="text-sm"
              />
              {proofUploading && <p className="text-sm text-muted-foreground">Uploading…</p>}
              {proofPath && proofPreviewUrl && !proofUploading && (
                <FileUploadPreview previewUrl={proofPreviewUrl} label={proofFileName ?? "Uploaded"} onRemove={handleRemoveProof} />
              )}
              {proofError && <p className="text-destructive text-sm">{proofError}</p>}
            </CardContent>
          </Card>
        )}

        {submitError && <p className="text-destructive text-sm">{submitError}</p>}

        <Button
          type="submit"
          disabled={
            isSubmitting || !proofPath || proofUploading || (fulfilmentMethod === "SHIPPING" && !selectedServiceCode)
          }
        >
          {isSubmitting ? "Placing order…" : "Place order"}
        </Button>
      </form>
    </main>
  );
}
