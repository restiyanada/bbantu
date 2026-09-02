import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Search } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/lib/supabaseClient";
import { formatIDR } from "@/lib/utils";
import { useProofUpload } from "@/lib/useProofUpload";
import { useShippingSelection } from "@/lib/useShippingSelection";
import { Button } from "@/components/ui/button";
import { ProductDetailSheet } from "@/components/product-detail-sheet";
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
import { YourDetailsStep, customerSchema, type CustomerValues } from "@/components/checkout/YourDetailsStep";
import { ReviewPayStep, type PaymentSettingsRow } from "@/components/checkout/ReviewPayStep";

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
          <YourDetailsStep
            register={register}
            errors={errors}
            fulfilmentMethod={fulfilmentMethod}
            onFulfilmentMethodChange={setFulfilmentMethod}
            shippingAllowed={shippingAllowed}
            shipping={shipping}
            cartItems={Object.entries(quantities)
              .filter(([, qty]) => qty > 0)
              .map(([variantId, quantity]) => ({ variantId, quantity }))}
            detailsError={detailsError}
            watch={watch}
          />
        )}

        {/* STEP 3: review & pay */}
        {step === 3 && (
          <ReviewPayStep
            activeItems={activeItems}
            quantities={quantities}
            subtotalCents={subtotalCents}
            shippingCostCents={shippingCostCents}
            amountDueNowCents={amountDueNowCents}
            grandTotalCents={grandTotalCents}
            effectivePaymentType={effectivePaymentType}
            fulfilmentMethod={fulfilmentMethod}
            paymentSettings={paymentSettings}
            proof={proof}
            submitError={submitError}
            selectedRate={selectedRate}
          />
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
