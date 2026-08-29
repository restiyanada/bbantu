import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertCircle, Clock, Package, Truck, CheckCircle2, ChevronRight } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { formatIDR, formatOrderNumber } from "@/lib/utils";
import { buildOrderTimeline, type OrderStatus } from "@/lib/order-timeline";
import { OrderTimelineDisplay } from "@/components/order-timeline";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "@/components/ui/button";
import { FileUploadPreview } from "@/components/ui/file-upload-preview";
import { FileInput } from "@/components/ui/file-input";
import { ProductDetailSheet } from "@/components/product-detail-sheet";
import { QrCode } from "@/components/ui/qr-code";
import { Skeleton } from "@/components/ui/skeleton";
import { PushNotificationToggle } from "@/components/push-notification-toggle";

interface OrderRow {
  id: string;
  order_number: number | null;
  status: string;
  sales_mode: string;
  payment_type: string;
  merchandise_subtotal: string;
  shipping_cost: string | null;
  amount_paid: string;
  fulfilment_method: string | null;
  created_at: string;
  batch_id: string | null;
}

interface OrderItemRow {
  quantity: number;
  unit_price: string;
  // Captured at checkout. Null on orders placed before the columns existed —
  // those fall back to the live join below, which is the behaviour they had.
  product_name: string | null;
  variant_name: string | null;
  image_urls: string[] | null;
  product_variants: {
    name: string;
    products: {
      name: string;
      description: string | null;
      image_url: string | null;
      product_images: { url: string; sort_order: number }[];
    } | null;
  } | null;
}

interface ResolvedItem {
  productName: string;
  variantName: string;
  description: string | null;
  photoUrls: string[];
  quantity: number;
  unitPrice: string;
}

/**
 * Prefer what was captured at checkout; fall back to the product as it is now.
 * The snapshot is what stops a later product edit from rewriting the record of
 * an order someone already placed.
 */
function resolveItem(item: OrderItemRow): ResolvedItem {
  const product = item.product_variants?.products ?? null;
  const live = [...(product?.product_images ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((i) => i.url);

  return {
    productName: item.product_name ?? product?.name ?? "Item",
    variantName: item.variant_name ?? item.product_variants?.name ?? "",
    // Descriptions stay live: an edit there is usually a correction that helps
    // the buyer, and it is not what identifies what they bought.
    description: product?.description ?? null,
    photoUrls:
      item.image_urls && item.image_urls.length > 0
        ? item.image_urls
        : live.length > 0
          ? live
          : product?.image_url
            ? [product.image_url]
            : [],
    quantity: item.quantity,
    unitPrice: item.unit_price,
  };
}

interface PaymentRow {
  status: string;
  amount: string;
  submitted_at: string;
  rejection_reason: string | null;
}

interface ShipmentRow {
  courier: string;
  service: string | null;
  recipient_name: string;
  address: string;
  destination_district_name: string;
  tracking_number: string | null;
}

const PROOF_BUCKET = "payment-proofs";
const MAX_PROOF_BYTES = 5 * 1024 * 1024;
const ACCEPTED_PROOF_TYPES = ["image/jpeg", "image/png", "image/webp"];

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      order: OrderRow;
      items: OrderItemRow[];
      payments: PaymentRow[];
      pickupToken: string | null;
      shipment: ShipmentRow | null;
      batchName: string | null;
    };

type BannerTone = "neutral" | "destructive" | "amber" | "info" | "success";

const BANNER_TONE_CLASSES: Record<BannerTone, string> = {
  neutral: "bg-muted border-border",
  destructive: "bg-red-50 border-red-200 text-red-900",
  amber: "bg-amber-50 border-amber-200 text-amber-900",
  info: "bg-blue-50 border-blue-200 text-blue-900",
  success: "bg-green-50 border-green-200 text-green-900",
};

const BANNER_ICON_CLASSES: Record<BannerTone, string> = {
  neutral: "bg-accent text-muted-foreground",
  destructive: "bg-red-100 text-red-700",
  amber: "bg-amber-100 text-amber-800",
  info: "bg-blue-100 text-blue-800",
  success: "bg-green-100 text-green-800",
};

export default function OrderPage() {
  const { accessToken } = useParams<{ accessToken: string }>();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  const [resubmitPath, setResubmitPath] = useState<string | null>(null);
  const [resubmitFileName, setResubmitFileName] = useState<string | null>(null);
  const [resubmitPreviewUrl, setResubmitPreviewUrl] = useState<string | null>(null);
  const [resubmitUploading, setResubmitUploading] = useState(false);
  const [resubmitting, setResubmitting] = useState(false);
  const [resubmitError, setResubmitError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ResolvedItem | null>(null);
  const resubmitInputRef = useRef<HTMLInputElement>(null);

  const [balancePath, setBalancePath] = useState<string | null>(null);
  const [balanceFileName, setBalanceFileName] = useState<string | null>(null);
  const [balancePreviewUrl, setBalancePreviewUrl] = useState<string | null>(null);
  const [balanceUploading, setBalanceUploading] = useState(false);
  const [balanceSubmitting, setBalanceSubmitting] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const balanceInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!accessToken) {
      setState({ kind: "error", message: "No order link provided." });
      return;
    }

    let cancelled = false;
    setState({ kind: "loading" });

    async function load(token: string) {
      // Goes through an Edge Function rather than a direct-from-browser
      // PostgREST query gated on a custom header, because that mechanism
      // proved unreliable on Supabase's hosted REST API — a token could hash-
      // match the stored value exactly (verified directly in Postgres) and
      // still return zero rows over the real HTTP path. Every other guest
      // action here (create-order, recover-order-access, resubmit-payment,
      // submit-balance-payment) already takes the token in the request body
      // and compares it on the service-role connection; this brings order
      // lookup in line with that instead of being the one path still relying
      // on the header trick.
      const { data, error: invokeError } = await supabase.functions.invoke("get-order", {
        body: { accessToken: token },
      });

      if (cancelled) return;

      if (invokeError || !data?.found) {
        if (invokeError) console.error("Order lookup failed:", invokeError);
        setState({
          kind: "error",
          message:
            "We couldn't find that order. Double-check the link you were sent, or contact us with your phone number.",
        });
        return;
      }

      setState({
        kind: "ready",
        order: data.order as OrderRow,
        items: (data.items as OrderItemRow[] | null) ?? [],
        payments: (data.payments as PaymentRow[] | null) ?? [],
        pickupToken: data.pickupToken ?? null,
        shipment: (data.shipment as ShipmentRow | null) ?? null,
        batchName: data.batchName ?? null,
      });
    }

    void load(accessToken);
    return () => {
      cancelled = true;
    };
  }, [accessToken, reloadKey]);

  if (state.kind === "loading") {
    return (
      <main className="p-4 sm:p-8 max-w-2xl mx-auto space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-20 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="p-4 sm:p-8">
        <h1 className="text-2xl font-semibold">Order not found</h1>
        <p className="text-muted-foreground mt-2">{state.message}</p>
      </main>
    );
  }

  async function handleResubmitFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !accessToken) return;
    setResubmitError(null);
    setResubmitPath(null);

    if (!ACCEPTED_PROOF_TYPES.includes(file.type)) {
      setResubmitError("Please upload a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > MAX_PROOF_BYTES) {
      setResubmitError("File is too large — please keep it under 5MB.");
      return;
    }

    setResubmitPreviewUrl(URL.createObjectURL(file));
    setResubmitUploading(true);
    const path = `${accessToken}/${crypto.randomUUID()}-${file.name}`;
    const { error } = await supabase.storage.from(PROOF_BUCKET).upload(path, file, { contentType: file.type });
    setResubmitUploading(false);

    if (error) {
      setResubmitError("Couldn't upload your payment proof. Please try again.");
      return;
    }
    setResubmitPath(path);
    setResubmitFileName(file.name);
  }

  function handleRemoveResubmitProof() {
    if (resubmitPreviewUrl) URL.revokeObjectURL(resubmitPreviewUrl);
    setResubmitPath(null);
    setResubmitFileName(null);
    setResubmitPreviewUrl(null);
    setResubmitError(null);
    if (resubmitInputRef.current) resubmitInputRef.current.value = "";
  }

  async function handleResubmit(orderId: string) {
    if (!accessToken || !resubmitPath) return;
    setResubmitting(true);
    setResubmitError(null);

    const { error, data } = await supabase.functions.invoke("resubmit-payment", {
      body: { orderId, accessToken, proofFileUrl: resubmitPath },
    });

    setResubmitting(false);

    if (error || !data) {
      setResubmitError("Couldn't resubmit your payment. Please try again.");
      return;
    }

    if (resubmitPreviewUrl) URL.revokeObjectURL(resubmitPreviewUrl);
    setResubmitPath(null);
    setResubmitFileName(null);
    setResubmitPreviewUrl(null);
    setReloadKey((k) => k + 1);
  }

  async function handleBalanceFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !accessToken) return;
    setBalanceError(null);
    setBalancePath(null);

    if (!ACCEPTED_PROOF_TYPES.includes(file.type)) {
      setBalanceError("Please upload a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > MAX_PROOF_BYTES) {
      setBalanceError("File is too large — please keep it under 5MB.");
      return;
    }

    setBalancePreviewUrl(URL.createObjectURL(file));
    setBalanceUploading(true);
    const path = `${accessToken}/${crypto.randomUUID()}-${file.name}`;
    const { error } = await supabase.storage.from(PROOF_BUCKET).upload(path, file, { contentType: file.type });
    setBalanceUploading(false);

    if (error) {
      setBalanceError("Couldn't upload your payment proof. Please try again.");
      return;
    }
    setBalancePath(path);
    setBalanceFileName(file.name);
  }

  function handleRemoveBalanceProof() {
    if (balancePreviewUrl) URL.revokeObjectURL(balancePreviewUrl);
    setBalancePath(null);
    setBalanceFileName(null);
    setBalancePreviewUrl(null);
    setBalanceError(null);
    if (balanceInputRef.current) balanceInputRef.current.value = "";
  }

  async function handleSubmitBalance(orderId: string) {
    if (!accessToken || !balancePath) return;
    setBalanceSubmitting(true);
    setBalanceError(null);

    const { error, data } = await supabase.functions.invoke("submit-balance-payment", {
      body: { orderId, accessToken, proofFileUrl: balancePath },
    });

    setBalanceSubmitting(false);

    if (error || !data) {
      setBalanceError("Couldn't submit your balance payment. Please try again.");
      return;
    }

    if (balancePreviewUrl) URL.revokeObjectURL(balancePreviewUrl);
    setBalancePath(null);
    setBalanceFileName(null);
    setBalancePreviewUrl(null);
    setReloadKey((k) => k + 1);
  }

  const { order, items, payments, pickupToken, shipment, batchName } = state;
  const shippingCost = order.shipping_cost ? Number(order.shipping_cost) : 0;
  const total = Number(order.merchandise_subtotal) + shippingCost;
  const balanceDue = total - Number(order.amount_paid);

  const timeline = buildOrderTimeline({
    status: order.status as OrderStatus,
    salesMode: order.sales_mode as "PRE_ORDER" | "READY_STOCK",
    paymentType: order.payment_type as "DP" | "FULL",
    fulfilmentMethod: (order.fulfilment_method as "PICKUP" | "SHIPPING" | null) ?? null,
  });

  const latestPayment = payments[0] ?? null;
  const isRejectedPending = latestPayment?.status === "REJECTED" && order.status === "PAYMENT_PENDING";
  const isBalanceDue = order.status === "BALANCE_DUE";
  const isPaymentPending = order.status === "PAYMENT_PENDING" && !isRejectedPending;
  const isDone = order.status === "PICKED_UP" || order.status === "COMPLETED";
  const isReadyForPickup =
    order.fulfilment_method === "PICKUP" &&
    !!pickupToken &&
    !isDone &&
    !isRejectedPending &&
    !isBalanceDue &&
    !isPaymentPending;
  const isShippedInfo =
    order.fulfilment_method === "SHIPPING" &&
    !!shipment?.tracking_number &&
    !isDone &&
    !isRejectedPending &&
    !isBalanceDue &&
    !isPaymentPending;

  let banner: { tone: BannerTone; Icon: typeof AlertCircle; title: string; body: string; extra?: React.ReactNode } | null = null;

  if (isRejectedPending) {
    banner = {
      tone: "destructive",
      Icon: AlertCircle,
      title: "Payment needs your attention",
      body: latestPayment?.rejection_reason
        ? `Rejected: ${latestPayment.rejection_reason}`
        : "Your payment was rejected. Please upload a new proof.",
      extra: (
        <div className="space-y-2 pt-1">
          <FileInput
            ref={resubmitInputRef}
            accept={ACCEPTED_PROOF_TYPES.join(",")}
            onChange={handleResubmitFileChange}
            disabled={resubmitUploading}
            hint="JPG, PNG or WebP"
          />
          {resubmitUploading && <p className="text-sm">Uploading…</p>}
          {resubmitPath && resubmitPreviewUrl && !resubmitUploading && (
            <FileUploadPreview
              previewUrl={resubmitPreviewUrl}
              label={resubmitFileName ?? "Uploaded"}
              onRemove={handleRemoveResubmitProof}
            />
          )}
          {resubmitError && <p className="text-sm font-medium">{resubmitError}</p>}
          <Button
            variant="destructive"
            size="sm"
            disabled={!resubmitPath || resubmitting}
            onClick={() => handleResubmit(order.id)}
          >
            {resubmitting ? "Resubmitting…" : "Resubmit payment"}
          </Button>
        </div>
      ),
    };
  } else if (isBalanceDue && latestPayment?.status === "PENDING") {
    banner = {
      tone: "amber",
      Icon: Clock,
      title: "Balance payment submitted",
      body: "Your balance payment is awaiting review.",
    };
  } else if (isBalanceDue) {
    banner = {
      tone: "amber",
      Icon: Clock,
      title: "Remaining balance due",
      body:
        `Your item is ready — upload proof for the remaining balance of ${formatIDR(balanceDue.toFixed(2))}.` +
        (latestPayment?.status === "REJECTED" && latestPayment.rejection_reason
          ? ` Previous attempt rejected: ${latestPayment.rejection_reason}`
          : ""),
      extra: (
        <div className="space-y-2 pt-1">
          <FileInput
            ref={balanceInputRef}
            accept={ACCEPTED_PROOF_TYPES.join(",")}
            onChange={handleBalanceFileChange}
            disabled={balanceUploading}
            hint="JPG, PNG or WebP"
          />
          {balanceUploading && <p className="text-sm">Uploading…</p>}
          {balancePath && balancePreviewUrl && !balanceUploading && (
            <FileUploadPreview
              previewUrl={balancePreviewUrl}
              label={balanceFileName ?? "Uploaded"}
              onRemove={handleRemoveBalanceProof}
            />
          )}
          {balanceError && <p className="text-sm font-medium">{balanceError}</p>}
          <Button
            variant="info"
            size="sm"
            disabled={!balancePath || balanceSubmitting}
            onClick={() => handleSubmitBalance(order.id)}
          >
            {balanceSubmitting ? "Submitting…" : "Submit balance payment"}
          </Button>
        </div>
      ),
    };
  } else if (isPaymentPending) {
    banner = {
      tone: "neutral",
      Icon: Clock,
      title: "Awaiting payment review",
      body: "We're reviewing your payment. This page will update once it's verified.",
    };
  } else if (isDone) {
    banner = { tone: "success", Icon: CheckCircle2, title: "Order complete", body: "Thanks for your order!" };
  } else if (isReadyForPickup) {
    banner = {
      tone: "info",
      Icon: Package,
      title: "Ready for pickup",
      body: "Show your pickup code at the booth — see below.",
    };
  } else if (isShippedInfo) {
    banner = {
      tone: "info",
      Icon: Truck,
      title: "On the way",
      body: `Shipped via ${shipment!.courier}${shipment!.service ? " — " + shipment!.service : ""}.`,
    };
  } else {
    banner = {
      tone: "neutral",
      Icon: Clock,
      title: "We're preparing your order",
      body: "We'll update this page as your order moves along.",
    };
  }

  return (
    <main className="p-4 sm:p-8 max-w-2xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">
            Order {formatOrderNumber(order.fulfilment_method, order.order_number, order.id)}
          </h1>
          {batchName && <p className="text-sm text-muted-foreground mt-1">Pre-order batch: {batchName}</p>}
          <p className="text-muted-foreground mt-1">Placed {new Date(order.created_at).toLocaleString("id-ID")}</p>
        </div>
        <PushNotificationToggle kind="CUSTOMER" accessToken={accessToken} showLabel />
      </div>

      {banner && (
        <div className={`rounded-2xl border p-4 ${BANNER_TONE_CLASSES[banner.tone]}`}>
          <div className="flex gap-3 items-start">
            <span
              className={`flex size-7 shrink-0 items-center justify-center rounded-full ${BANNER_ICON_CLASSES[banner.tone]}`}
            >
              <banner.Icon className="size-4" />
            </span>
            <div className="flex-1 min-w-0 space-y-1">
              <p className="font-semibold text-sm">{banner.title}</p>
              <p className="text-sm">{banner.body}</p>
              {banner.extra}
            </div>
          </div>
        </div>
      )}

      <Card>
        <CardContent>
          <OrderTimelineDisplay timeline={timeline} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0.5">
          {items.map((raw, i) => {
            const item = resolveItem(raw);
            const label = item.variantName ? `${item.productName} — ${item.variantName}` : item.productName;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setDetail(item)}
                className="flex w-full items-center gap-3 rounded-lg p-2 text-left text-sm transition-colors hover:bg-muted/60 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <span className="relative shrink-0">
                  {item.photoUrls.length > 0 ? (
                    <img src={item.photoUrls[0]} alt="" className="size-12 rounded-lg border object-cover" />
                  ) : (
                    <span className="block size-12 rounded-lg border bg-muted" />
                  )}
                  {item.photoUrls.length > 1 && (
                    <span className="absolute -bottom-1 -right-1 min-w-[18px] rounded-full border-[1.5px] border-background bg-primary px-1 text-center text-[10px] font-bold leading-[15px] text-primary-foreground">
                      {item.photoUrls.length}
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{label}</span>
                  <span className="block text-xs text-muted-foreground">
                    Qty {item.quantity}
                    {item.photoUrls.length > 1 && ` · ${item.photoUrls.length} photos`}
                  </span>
                </span>
                <span className="whitespace-nowrap">{formatIDR(item.unitPrice)}</span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            );
          })}
        </CardContent>
      </Card>

      <ProductDetailSheet
        open={detail !== null}
        onOpenChange={(open) => !open && setDetail(null)}
        name={detail?.productName ?? ""}
        description={detail?.description}
        photoUrls={detail?.photoUrls ?? []}
        aside={
          detail && (
            <div className="text-right">
              <p className="text-base font-semibold leading-6 whitespace-nowrap">{formatIDR(detail.unitPrice)}</p>
              <p className="text-xs text-muted-foreground">Qty {detail.quantity}</p>
            </div>
          )
        }
      >
        {detail?.variantName && <p className="text-sm">{detail.variantName}</p>}
      </ProductDetailSheet>


      <Card>
        <CardHeader>
          <CardTitle>Payment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span>Merchandise subtotal</span>
            <span>{formatIDR(order.merchandise_subtotal)}</span>
          </div>
          {order.shipping_cost && (
            <div className="flex justify-between">
              <span>Shipping</span>
              <span>{formatIDR(order.shipping_cost)}</span>
            </div>
          )}
          <div className="flex justify-between font-medium">
            <span>Amount paid</span>
            <span>{formatIDR(order.amount_paid)}</span>
          </div>
          <div className="flex justify-between font-medium">
            <span>Balance due</span>
            <span>{formatIDR(balanceDue.toFixed(2))}</span>
          </div>
          {payments.length > 0 && (
            <div className="pt-2 mt-2 border-t space-y-1">
              {payments.map((p, i) => (
                <div key={i} className="flex justify-between text-muted-foreground">
                  <span>Payment ({p.status.toLowerCase()})</span>
                  <span>{formatIDR(p.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {order.fulfilment_method === "PICKUP" && pickupToken && order.status !== "PICKED_UP" && (
        <Card>
          <CardHeader>
            <CardTitle>Pickup</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-3">
            <p className="text-muted-foreground">
              Show this code at the booth. Staff will scan it to confirm your pickup.
            </p>
            <div className="flex justify-center rounded-lg bg-muted p-4">
              <QrCode value={pickupToken} size={180} className="rounded bg-background p-2" />
            </div>
            <p className="text-center font-mono text-xs tracking-widest text-muted-foreground">{pickupToken}</p>
          </CardContent>
        </Card>
      )}

      {order.fulfilment_method === "SHIPPING" && shipment && (
        <Card>
          <CardHeader>
            <CardTitle>Shipping</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Delivering to</span>
              <span className="text-right">
                {shipment.recipient_name}
                <br />
                {shipment.address}, {shipment.destination_district_name}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Courier</span>
              <span>
                {shipment.courier}
                {shipment.service ? ` — ${shipment.service}` : ""}
              </span>
            </div>
            {shipment.tracking_number ? (
              <div className="flex justify-between pt-2 mt-2 border-t">
                <span className="text-muted-foreground">Tracking number</span>
                <span className="font-mono">{shipment.tracking_number}</span>
              </div>
            ) : (
              <p className="text-muted-foreground pt-2 mt-2 border-t">Tracking number not recorded yet.</p>
            )}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
