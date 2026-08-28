import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertCircle, Clock, Package, Truck, CheckCircle2 } from "lucide-react";
import { createGuestOrderClient, supabase } from "../lib/supabaseClient";
import { formatIDR, formatOrderNumber } from "@/lib/utils";
import { buildOrderTimeline, type OrderStatus } from "@/lib/order-timeline";
import { OrderTimelineDisplay } from "@/components/order-timeline";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "@/components/ui/button";
import { FileUploadPreview } from "@/components/ui/file-upload-preview";

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
  product_variants: { name: string; products: { image_url: string | null } | null } | null;
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
      const client = createGuestOrderClient(token);

      const { data: order, error: orderError } = await client
        .from("orders")
        .select(
          "id, order_number, status, sales_mode, payment_type, merchandise_subtotal, shipping_cost, amount_paid, fulfilment_method, created_at, batch_id"
        )
        .maybeSingle();

      if (cancelled) return;

      if (orderError || !order) {
        setState({
          kind: "error",
          message:
            "We couldn't find that order. Double-check the link you were sent, or contact us with your phone number.",
        });
        return;
      }

      const [itemsResult, paymentsResult, pickupResult, shipmentResult, batchResult] = await Promise.all([
        client
          .from("order_items")
          .select("quantity, unit_price, product_variants(name, products(image_url))")
          .eq("order_id", order.id),
        client
          .from("payments")
          .select("status, amount, submitted_at, rejection_reason")
          .eq("order_id", order.id)
          .order("submitted_at", { ascending: false }),
        client.from("pickup_tokens").select("token").eq("order_id", order.id).maybeSingle(),
        client
          .from("shipments")
          .select("courier, service, recipient_name, address, destination_district_name, tracking_number")
          .eq("order_id", order.id)
          .maybeSingle(),
        order.batch_id
          ? supabase.from("batches").select("name").eq("id", order.batch_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      if (cancelled) return;

      setState({
        kind: "ready",
        order,
        items: (itemsResult.data as OrderItemRow[] | null) ?? [],
        payments: paymentsResult.data ?? [],
        pickupToken: pickupResult.data?.token ?? null,
        shipment: (shipmentResult.data as ShipmentRow | null) ?? null,
        batchName: (batchResult.data as { name: string } | null)?.name ?? null,
      });
    }

    void load(accessToken);
    return () => {
      cancelled = true;
    };
  }, [accessToken, reloadKey]);

  if (state.kind === "loading") {
    return (
      <main className="p-4 sm:p-8">
        <p className="text-muted-foreground">Loading your order…</p>
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
          <input
            ref={resubmitInputRef}
            type="file"
            accept={ACCEPTED_PROOF_TYPES.join(",")}
            onChange={handleResubmitFileChange}
            disabled={resubmitUploading}
            className="text-sm"
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
          <input
            ref={balanceInputRef}
            type="file"
            accept={ACCEPTED_PROOF_TYPES.join(",")}
            onChange={handleBalanceFileChange}
            disabled={balanceUploading}
            className="text-sm"
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
      <div>
        <h1 className="text-4xl font-bold tracking-tight">
          Order {formatOrderNumber(order.fulfilment_method, order.order_number, order.id)}
        </h1>
        {batchName && <p className="text-sm text-muted-foreground mt-1">Pre-order batch: {batchName}</p>}
        <p className="text-muted-foreground mt-1">Placed {new Date(order.created_at).toLocaleString("id-ID")}</p>
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
        <CardContent className="space-y-2">
          {items.map((item, i) => {
            const imageUrl = item.product_variants?.products?.image_url ?? null;
            return (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  {imageUrl ? (
                    <img src={imageUrl} alt="" className="h-10 w-10 rounded-lg object-cover border" />
                  ) : (
                    <span className="h-10 w-10 rounded-lg border bg-muted" />
                  )}
                  {item.product_variants?.name ?? "Item"} × {item.quantity}
                </span>
                <span>{formatIDR(item.unit_price)}</span>
              </div>
            );
          })}
        </CardContent>
      </Card>

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
          <CardContent className="text-sm space-y-2">
            <p className="text-muted-foreground">
              Show this code at the booth. Staff will scan it to confirm your pickup.
            </p>
            <p className="font-mono text-xs break-all bg-muted rounded p-2">{pickupToken}</p>
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
