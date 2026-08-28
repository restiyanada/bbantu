import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { createGuestOrderClient, supabase } from "../lib/supabaseClient";
import { formatIDR, formatOrderNumber } from "@/lib/utils";
import { buildOrderTimeline, type OrderStatus } from "@/lib/order-timeline";
import { OrderTimelineDisplay } from "@/components/order-timeline";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "@/components/ui/button";

// Raw Postgres column names (snake_case) — these queries go straight through
// supabase-js/PostgREST, not drizzle, so they use the actual DB column names
// from db/schema.ts, not the camelCase TS property names.
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
  product_variants: { name: string } | null;
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

export default function OrderPage() {
  const { accessToken } = useParams<{ accessToken: string }>();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  // Resubmission (after a rejected payment) UI state.
  const [resubmitPath, setResubmitPath] = useState<string | null>(null);
  const [resubmitFileName, setResubmitFileName] = useState<string | null>(null);
  const [resubmitUploading, setResubmitUploading] = useState(false);
  const [resubmitting, setResubmitting] = useState(false);
  const [resubmitError, setResubmitError] = useState<string | null>(null);

  // Balance payment (DP order's remaining amount, Milestone 2) UI state —
  // same shape as resubmission above, just a different endpoint.
  const [balancePath, setBalancePath] = useState<string | null>(null);
  const [balanceFileName, setBalanceFileName] = useState<string | null>(null);
  const [balanceUploading, setBalanceUploading] = useState(false);
  const [balanceSubmitting, setBalanceSubmitting] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) {
      setState({ kind: "error", message: "No order link provided." });
      return;
    }

    let cancelled = false;
    setState({ kind: "loading" });

    async function load(token: string) {
      const client = createGuestOrderClient(token);

      // Milestone 5: no `.eq("access_token", token)` filter here anymore —
      // access_token now stores a hash (db/schema.ts), so comparing it to
      // the raw token directly would never match. RLS's own policy already
      // restricts an anon read to exactly the one order whose hash matches
      // the x-order-access-token header (see createGuestOrderClient), so a
      // plain unfiltered select on this table already returns at most one
      // row — the redundant client-side filter was never load-bearing for
      // security, only for clarity, and now it'd just be wrong.
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
          .select("quantity, unit_price, product_variants(name)")
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
        // Ready-stock orders have no batch — batches table itself has no RLS
        // (public catalog, same as products), so a plain read is fine here.
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
      <main className="p-8">
        <p className="text-gray-500">Loading your order…</p>
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold">Order not found</h1>
        <p className="text-gray-500 mt-2">{state.message}</p>
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

    setResubmitPath(null);
    setResubmitFileName(null);
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

    setBalancePath(null);
    setBalanceFileName(null);
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

  return (
    <main className="p-8 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          Order {formatOrderNumber(order.fulfilment_method, order.order_number, order.id)}
        </h1>
        {batchName && <p className="text-sm text-gray-600 mt-1">Pre-order batch: {batchName}</p>}
        <p className="text-gray-500 mt-1">Placed {new Date(order.created_at).toLocaleString("id-ID")}</p>
      </div>

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
          {items.map((item, i) => (
            <div key={i} className="flex justify-between text-sm">
              <span>
                {item.product_variants?.name ?? "Item"} × {item.quantity}
              </span>
              <span>{formatIDR(item.unit_price)}</span>
            </div>
          ))}
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
                <div key={i} className="flex justify-between text-gray-500">
                  <span>Payment ({p.status.toLowerCase()})</span>
                  <span>{formatIDR(p.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {payments[0]?.status === "REJECTED" && order.status === "PAYMENT_PENDING" && (
        <Card>
          <CardHeader>
            <CardTitle>Payment rejected</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {payments[0].rejection_reason && (
              <p className="text-gray-600">Reason: {payments[0].rejection_reason}</p>
            )}
            <p className="text-gray-500">Upload a new payment proof to try again.</p>
            <input
              type="file"
              accept={ACCEPTED_PROOF_TYPES.join(",")}
              onChange={handleResubmitFileChange}
              disabled={resubmitUploading}
              className="text-sm"
            />
            {resubmitUploading && <p className="text-gray-500">Uploading…</p>}
            {resubmitPath && !resubmitUploading && (
              <p className="text-green-700">Uploaded: {resubmitFileName}</p>
            )}
            {resubmitError && <p className="text-destructive">{resubmitError}</p>}
            <Button
              variant="info"
              disabled={!resubmitPath || resubmitting}
              onClick={() => handleResubmit(order.id)}
            >
              {resubmitting ? "Resubmitting…" : "Resubmit payment"}
            </Button>
          </CardContent>
        </Card>
      )}

      {order.status === "BALANCE_DUE" && (
        <Card>
          <CardHeader>
            <CardTitle>Balance payment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {payments[0]?.status === "PENDING" ? (
              <p className="text-gray-500">Your balance payment is awaiting review.</p>
            ) : (
              <>
                {payments[0]?.status === "REJECTED" && payments[0].rejection_reason && (
                  <p className="text-gray-600">Previous attempt rejected: {payments[0].rejection_reason}</p>
                )}
                <p className="text-gray-500">
                  Your item is ready — upload proof for the remaining balance of {formatIDR(balanceDue.toFixed(2))}.
                </p>
                <input
                  type="file"
                  accept={ACCEPTED_PROOF_TYPES.join(",")}
                  onChange={handleBalanceFileChange}
                  disabled={balanceUploading}
                  className="text-sm"
                />
                {balanceUploading && <p className="text-gray-500">Uploading…</p>}
                {balancePath && !balanceUploading && (
                  <p className="text-green-700">Uploaded: {balanceFileName}</p>
                )}
                {balanceError && <p className="text-destructive">{balanceError}</p>}
                <Button
                  variant="info"
                  disabled={!balancePath || balanceSubmitting}
                  onClick={() => handleSubmitBalance(order.id)}
                >
                  {balanceSubmitting ? "Submitting…" : "Submit balance payment"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {order.fulfilment_method === "PICKUP" && pickupToken && order.status !== "PICKED_UP" && (
        <Card>
          <CardHeader>
            <CardTitle>Pickup</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <p className="text-gray-500">
              Show this code at the booth. Staff will scan it to confirm your pickup.
            </p>
            {/* Rendering this as an actual scannable QR image (§13.3) is left
                for a follow-up pass — this page is scoped to reading real
                order data, not building the QR-rendering component yet. */}
            <p className="font-mono text-xs break-all bg-gray-100 rounded p-2">{pickupToken}</p>
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
              <span className="text-gray-500">Delivering to</span>
              <span className="text-right">
                {shipment.recipient_name}
                <br />
                {shipment.address}, {shipment.destination_district_name}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Courier</span>
              <span>
                {shipment.courier}
                {shipment.service ? ` — ${shipment.service}` : ""}
              </span>
            </div>
            {shipment.tracking_number ? (
              <div className="flex justify-between pt-2 mt-2 border-t">
                <span className="text-gray-500">Tracking number</span>
                <span className="font-mono">{shipment.tracking_number}</span>
              </div>
            ) : (
              <p className="text-gray-500 pt-2 mt-2 border-t">Tracking number not recorded yet.</p>
            )}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
