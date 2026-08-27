import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "@/lib/supabaseClient";
import { formatIDR } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface VariantRow {
  id: string;
  name: string;
  price: string;
}

interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  product_variants: VariantRow[];
}

interface PaymentSettingsRow {
  bank_name: string;
  account_number: string;
  account_holder_name: string;
}

// Raw PostgREST embed shapes for open batches (Milestone 2).
interface RawBatchItem {
  id: string;
  variant_id: string;
  product_variants: { name: string; price: string; products: { name: string } | null };
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
}

interface BatchOption {
  id: string;
  name: string;
  allowedPaymentTypes: string[];
  allowedFulfilmentMethods: string[];
  items: SelectableItem[];
}

// Milestone 3 — shipping address + rate quote.
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
const MAX_PROOF_BYTES = 5 * 1024 * 1024; // 5MB, matches supabase/storage_setup.sql
const ACCEPTED_PROOF_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Same patterns as create-order's server-side validation — this is the UX
// nicety only; the Edge Function re-validates identically (§3 principle 5).
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

  // "READY_STOCK" or a batch id — which section the customer is ordering
  // from right now. An order can only belong to one sales mode/batch
  // (orders.batchId is a single column), so switching sections clears
  // quantities rather than trying to merge across them.
  const [activeSource, setActiveSource] = useState<string>("READY_STOCK");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [paymentType, setPaymentType] = useState<"DP" | "FULL">("FULL");

  const [paymentSettings, setPaymentSettings] = useState<PaymentSettingsRow | null>(null);

  // Milestone 3 — fulfilment method + shipping address/rate quote state.
  // Kept as plain useState, not folded into the react-hook-form `customer`
  // resolver above — same convention already used for items/proof upload:
  // only the customer name/phone/email block uses react-hook-form here.
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

  // Payment proof upload state. `proofPath` is what actually gets sent to
  // create-order — a Storage path within PROOF_BUCKET, not a public URL (the
  // bucket has no public read at all, see supabase/storage_setup.sql).
  const [proofPath, setProofPath] = useState<string | null>(null);
  const [proofFileName, setProofFileName] = useState<string | null>(null);
  const [proofUploading, setProofUploading] = useState(false);
  const [proofError, setProofError] = useState<string | null>(null);

  // Client-generated once per visit — the unique constraint on
  // orders.submission_token is what actually enforces "one order per
  // submit" (§19); this is just the value that gets reused if the button
  // is double-clicked, and swapped for a new one after a failed attempt.
  // Also used as the upload path prefix, so a proof can be uploaded before
  // the order (and its id) exists yet.
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
      // Products/variants and open batches have no RLS (public storefront
      // catalog, §5) — a plain read, not something that needs the guest
      // order-access token.
      const [productsResult, batchesResult, settingsResult] = await Promise.all([
        supabase.from("products").select("id, name, description, product_variants(id, name, price)").eq("active", true),
        supabase
          .from("batches")
          .select(
            "id, name, allowed_payment_types, allowed_fulfilment_methods, batch_items(id, variant_id, product_variants(name, price, products(name)))"
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

      // Cast through `unknown` first: without generated Database types, the
      // untyped supabase-js client can't know these nested embeds are
      // one-to-one rather than one-to-many.
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

  // Milestone 3 — provinces are a small, rarely-changing, free-to-call list
  // (§15.2), loaded once regardless of whether the customer ever picks
  // Shipping, so the dropdown is instant if they do.
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
    setSelectedServiceCode(fetchedRates[0].serviceCode); // cheapest/first by default — customer can change it
  }

  const activeBatch = activeSource === "READY_STOCK" ? null : batches?.find((b) => b.id === activeSource) ?? null;

  // Ready stock has no batch to restrict it — Shipping is always offered.
  // A pre-order batch only offers Shipping if it was configured to (§13.1).
  const shippingAllowed = activeBatch ? activeBatch.allowedFulfilmentMethods.includes("SHIPPING") : true;

  // Unified list of what's orderable in the currently-active section, so
  // quantity state / subtotal math doesn't need two separate code paths.
  const activeItems: SelectableItem[] =
    activeSource === "READY_STOCK"
      ? (products ?? []).flatMap((p) =>
          p.product_variants.map((v) => ({ variantId: v.id, label: `${p.name} — ${v.name}`, price: v.price }))
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

  // Shipping (when chosen) is always paid in full alongside whatever's due
  // now — same design as create-order's server-side calc (see that file's
  // doc comment for the reasoning and the open flag on this interpretation).
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
              // Recipient is the same person filling out "Your details" —
              // no separate name/phone entry, per feedback that asking twice
              // was redundant. Already validated by customerSchema above.
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
      // A fresh token for the retry avoids any ambiguity about whether the
      // failed attempt's token might be considered used server-side. The
      // already-uploaded proof stays valid (it's keyed by the old token's
      // folder), but the new submission needs a token of its own too, so
      // simplest is to ask for a fresh upload alongside the fresh token.
      setSubmissionToken(crypto.randomUUID());
      setProofPath(null);
      setProofFileName(null);
      return;
    }

    navigate(`/orders/${data.accessToken}`);
  }

  return (
    <main className="p-8 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Pre-Order &amp; Ready Stock System</h1>
        <p className="text-gray-500 mt-1">Pick an item, enter your details, and place your order.</p>
      </div>

      {batches !== null && batches.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => handleSourceChange("READY_STOCK")}
            className={`text-sm px-3 py-1.5 rounded-md border ${
              activeSource === "READY_STOCK" ? "bg-primary text-primary-foreground" : "bg-background"
            }`}
          >
            Ready stock
          </button>
          {batches.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => handleSourceChange(b.id)}
              className={`text-sm px-3 py-1.5 rounded-md border ${
                activeSource === b.id ? "bg-primary text-primary-foreground" : "bg-background"
              }`}
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
          {!loadError && products === null && <p className="text-gray-500 text-sm">Loading items…</p>}
          {activeSource === "READY_STOCK" && products !== null && products.length === 0 && (
            <p className="text-gray-500 text-sm">Nothing available to order right now.</p>
          )}

          {activeSource === "READY_STOCK" &&
            products?.map((product) => (
              <div key={product.id} className="space-y-2">
                <div>
                  <p className="font-medium">{product.name}</p>
                  {product.description && <p className="text-sm text-gray-500">{product.description}</p>}
                </div>
                {product.product_variants.map((variant) => (
                  <div key={variant.id} className="flex items-center justify-between text-sm pl-3">
                    <span>
                      {variant.name} — {formatIDR(variant.price)}
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={quantities[variant.id] ?? 0}
                      onChange={(e) =>
                        setQuantities((prev) => ({
                          ...prev,
                          [variant.id]: Math.max(0, Number(e.target.value) || 0),
                        }))
                      }
                      className="w-16 rounded-md border bg-background px-2 py-1 text-sm text-right"
                    />
                  </div>
                ))}
              </div>
            ))}

          {activeBatch && (
            <div className="space-y-2">
              {activeBatch.items.length === 0 && (
                <p className="text-gray-500 text-sm">This batch has no items yet.</p>
              )}
              {activeBatch.items.map((item) => (
                <div key={item.variantId} className="flex items-center justify-between text-sm">
                  <span>
                    {item.label} — {formatIDR(item.price)}
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={quantities[item.variantId] ?? 0}
                    onChange={(e) =>
                      setQuantities((prev) => ({
                        ...prev,
                        [item.variantId]: Math.max(0, Number(e.target.value) || 0),
                      }))
                    }
                    className="w-16 rounded-md border bg-background px-2 py-1 text-sm text-right"
                  />
                </div>
              ))}
              {activeBatch.allowedPaymentTypes.length > 1 && (
                <div className="pt-2 mt-2 border-t flex gap-4 text-sm">
                  {activeBatch.allowedPaymentTypes.includes("FULL") && (
                    <label className="flex items-center gap-1.5">
                      <input
                        type="radio"
                        checked={paymentType === "FULL"}
                        onChange={() => setPaymentType("FULL")}
                      />
                      Pay in full
                    </label>
                  )}
                  {activeBatch.allowedPaymentTypes.includes("DP") && (
                    <label className="flex items-center gap-1.5">
                      <input type="radio" checked={paymentType === "DP"} onChange={() => setPaymentType("DP")} />
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
            <div>
              <label htmlFor="name" className="text-sm font-medium">
                Name
              </label>
              <input
                id="name"
                {...register("name")}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              {errors.name && <p className="text-destructive text-xs mt-1">{errors.name.message}</p>}
            </div>
            <div>
              <label htmlFor="phone" className="text-sm font-medium">
                Phone number
              </label>
              <input
                id="phone"
                {...register("phone")}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              {errors.phone && <p className="text-destructive text-xs mt-1">{errors.phone.message}</p>}
            </div>
            <div>
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                type="email"
                {...register("email")}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              {errors.email && <p className="text-destructive text-xs mt-1">{errors.email.message}</p>}
            </div>
          </CardContent>
        </Card>

        {hasItems && shippingAllowed && (
          <Card>
            <CardHeader>
              <CardTitle>Fulfilment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex gap-4">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={fulfilmentMethod === "PICKUP"}
                    onChange={() => setFulfilmentMethod("PICKUP")}
                  />
                  Booth pickup
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={fulfilmentMethod === "SHIPPING"}
                    onChange={() => setFulfilmentMethod("SHIPPING")}
                  />
                  Shipping (JNE)
                </label>
              </div>

              {fulfilmentMethod === "SHIPPING" && (
                <div className="space-y-3 pt-2 border-t">
                  {locationError && <p className="text-destructive text-xs">{locationError}</p>}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label className="text-xs text-gray-500">Province</label>
                      <select
                        value={selectedProvinceCode}
                        onChange={(e) => void handleProvinceChange(e.target.value)}
                        className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                      >
                        <option value="">
                          {provinces === null ? "Loading…" : "Select province"}
                        </option>
                        {provinces?.map((p) => (
                          <option key={p.code} value={p.code}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">City / Regency</label>
                      <select
                        value={selectedCityCode}
                        onChange={(e) => void handleCityChange(e.target.value)}
                        disabled={!selectedProvinceCode}
                        className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm disabled:opacity-50"
                      >
                        <option value="">{cities === null ? "—" : "Select city"}</option>
                        {cities?.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">District</label>
                      <select
                        value={selectedDistrict?.code ?? ""}
                        onChange={(e) => handleDistrictChange(e.target.value)}
                        disabled={!selectedCityCode}
                        className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm disabled:opacity-50"
                      >
                        <option value="">{districts === null ? "—" : "Select district"}</option>
                        {districts?.map((d) => (
                          <option key={d.code} value={d.code}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-gray-500">Street address, RT/RW, landmark, etc.</label>
                    <textarea
                      value={addressDetail}
                      onChange={(e) => setAddressDetail(e.target.value)}
                      rows={2}
                      className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                    />
                  </div>

                  {/* Recipient is whoever filled in "Your details" above —
                      no separate name/phone entry. This just reflects those
                      fields live so it's clear who the package is going to. */}
                  <p className="text-xs text-gray-500">
                    Shipping to <span className="font-medium text-gray-700">{watch("name") || "—"}</span> ·{" "}
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
                          className="flex items-center justify-between rounded-md border px-3 py-2 cursor-pointer"
                        >
                          <span className="flex items-center gap-2">
                            <input
                              type="radio"
                              checked={selectedServiceCode === rate.serviceCode}
                              onChange={() => setSelectedServiceCode(rate.serviceCode)}
                            />
                            JNE {rate.serviceName}
                            {rate.etd && <span className="text-gray-500"> · {rate.etd} days</span>}
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
                <div className="rounded-md bg-amber-50 border border-amber-200 p-3 space-y-1">
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
                <div className="rounded-md bg-blue-50 border border-blue-200 p-3">
                  <p className="font-medium text-blue-900">You're paying the full amount now.</p>
                  <div className="flex justify-between text-blue-900 mt-1">
                    <span>Amount to transfer</span>
                    <span className="font-semibold">{formatIDR((amountDueNowCents / 100).toFixed(2))}</span>
                  </div>
                </div>
              )}

              {paymentSettings ? (
                <div className="pt-2 mt-2 border-t space-y-1">
                  <p className="text-gray-500">Transfer to:</p>
                  <p>
                    <span className="font-medium">{paymentSettings.bank_name}</span> —{" "}
                    {paymentSettings.account_number}
                  </p>
                  <p className="text-gray-500">a.n. {paymentSettings.account_holder_name}</p>
                </div>
              ) : (
                <p className="text-gray-500 pt-2 mt-2 border-t">
                  Bank account details aren't configured yet — contact us before paying.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {hasItems && (
          <Card>
            <CardHeader>
              <CardTitle>Payment proof</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-gray-500">
                Upload a screenshot of your transfer receipt for the amount shown above.
              </p>
              <input
                type="file"
                accept={ACCEPTED_PROOF_TYPES.join(",")}
                onChange={handleProofFileChange}
                disabled={proofUploading}
                className="text-sm"
              />
              {proofUploading && <p className="text-sm text-gray-500">Uploading…</p>}
              {proofPath && !proofUploading && <p className="text-sm text-green-700">Uploaded: {proofFileName}</p>}
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
