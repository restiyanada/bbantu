import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Search } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "@/lib/supabaseClient";
import { formatIDR } from "@/lib/utils";
import { ACCEPTED_IMAGE_TYPES } from "@/lib/fileUpload";
import { useProofUpload } from "@/lib/useProofUpload";
import { useShippingSelection } from "@/lib/useShippingSelection";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileUploadPreview } from "@/components/ui/file-upload-preview";
import { ProductDetailSheet } from "@/components/product-detail-sheet";
import { FileInput } from "@/components/ui/file-input";
import { Input, Textarea, Select } from "@/components/ui/input";
import { Label, RequiredMark } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { CheckoutSteps } from "@/components/checkout/CheckoutSteps";
import { CheckoutNavBar } from "@/components/checkout/CheckoutNavBar";
import {
  ChooseItemsStep,
  QuantityRow,
  photoUrlsOf,
  type ProductImageRow,
  type ProductRow,
  type SelectableItem,
  type BatchOption,
  type DetailTarget,
} from "@/components/checkout/ChooseItemsStep";

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
  const shipping = useShippingSelection();

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
    shipping.resetRates();
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

  const selectedRate = shipping.rates?.find((r) => r.serviceCode === shipping.selectedServiceCode) ?? null;
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
      if (!shipping.selectedDistrict || !shipping.addressDetail.trim()) {
        setDetailsError("Please complete the delivery address.");
        return;
      }
      if (!shipping.selectedServiceCode) {
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
      if (!shipping.selectedDistrict || !shipping.addressDetail.trim() || !shipping.selectedServiceCode) {
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
                address: shipping.addressDetail.trim(),
                destinationDistrictCode: shipping.selectedDistrict!.code,
                destinationDistrictName: shipping.selectedDistrict!.name,
                serviceCode: shipping.selectedServiceCode,
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
      <CheckoutSteps step={step} onStepClick={setStep} />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* STEP 1: choose items */}
        {step === 1 && (
          <ChooseItemsStep
            products={products}
            batches={batches ?? []}
            activeSource={activeSource}
            onSourceChange={handleSourceChange}
            quantities={quantities}
            onQuantityChange={setQuantity}
            itemsError={itemsError}
            onOpenDetail={setDetail}
            paymentType={paymentType}
            onPaymentTypeChange={setPaymentType}
            loadError={loadError}
          />
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
                      {shipping.locationError && <p className="text-destructive text-xs">{shipping.locationError}</p>}

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            Province
                            <RequiredMark />
                          </Label>
                          <Select
                            value={shipping.selectedProvinceCode}
                            onChange={(e) => void shipping.handleProvinceChange(e.target.value)}
                            className="h-8 text-sm"
                          >
                            <option value="">
                              {shipping.provinces === null ? "Loading…" : "Select province"}
                            </option>
                            {shipping.provinces?.map((p) => (
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
                            value={shipping.selectedCityCode}
                            onChange={(e) => void shipping.handleCityChange(e.target.value)}
                            disabled={!shipping.selectedProvinceCode}
                            className="h-8 text-sm"
                          >
                            <option value="">{shipping.cities === null ? "—" : "Select city"}</option>
                            {shipping.cities?.map((c) => (
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
                            value={shipping.selectedDistrict?.code ?? ""}
                            onChange={(e) => shipping.handleDistrictChange(e.target.value)}
                            disabled={!shipping.selectedCityCode}
                            className="h-8 text-sm"
                          >
                            <option value="">{shipping.districts === null ? "—" : "Select district"}</option>
                            {shipping.districts?.map((d) => (
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
                          value={shipping.addressDetail}
                          onChange={(e) => shipping.setAddressDetail(e.target.value)}
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
                        disabled={!shipping.selectedDistrict || shipping.rateLoading}
                        onClick={() =>
                          void shipping.handleGetRate(
                            Object.entries(quantities)
                              .filter(([, qty]) => qty > 0)
                              .map(([variantId, quantity]) => ({ variantId, quantity }))
                          )
                        }
                      >
                        {shipping.rateLoading ? "Getting rate…" : "Get shipping rate"}
                      </Button>
                      {shipping.rateError && <p className="text-destructive text-xs">{shipping.rateError}</p>}

                      {shipping.rates && shipping.rates.length > 0 && (
                        <div className="space-y-1.5 pt-1">
                          {shipping.rates.map((rate) => (
                            <label
                              key={rate.serviceCode}
                              className={cn(
                                "flex items-center justify-between rounded-lg border px-3 py-2 cursor-pointer transition-colors",
                                shipping.selectedServiceCode === rate.serviceCode
                                  ? "border-primary bg-accent"
                                  : "hover:bg-muted"
                              )}
                            >
                              <span className="flex items-center gap-2">
                                <input
                                  type="radio"
                                  checked={shipping.selectedServiceCode === rate.serviceCode}
                                  onChange={() => shipping.setSelectedServiceCode(rate.serviceCode)}
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
        <CheckoutNavBar
          step={step}
          cartCount={cartCount}
          subtotal={formatIDR(subtotal)}
          continueDisabled={!hasItems}
          submitDisabled={
            !proof.path || proof.uploading || (fulfilmentMethod === "SHIPPING" && !shipping.selectedServiceCode)
          }
          isSubmitting={isSubmitting}
          onBack={() => setStep(step - 1)}
          onContinue={step === 1 ? handleContinueFromItems : () => void handleContinueFromDetails()}
        />
      </form>
    </main>
  );
}
