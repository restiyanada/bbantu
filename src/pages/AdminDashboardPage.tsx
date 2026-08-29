import { useEffect, useState, useCallback, useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { RotateCw, X, Printer } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseClient";
import { useAdminAuth } from "@/lib/adminAuth";
import { formatIDR, formatOrderNumber, functionErrorMessage, statusBadgeVariant } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PaymentRejectionForm } from "@/components/payment-rejection-form";
import { TrackingForm } from "@/components/tracking-form";
import { DataTable, type DataTableFilter } from "@/components/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import AdminLayout from "@/components/AdminLayout";
import { ShippingLabel, type ShippingLabelSender } from "@/components/shipping-label";
import { ImageZoom } from "@/components/ui/image-zoom";

interface LatestPayment {
  id: string;
  status: string;
  amount: string;
  proofUrl: string | null;
  proofDeletedAt: string | null;
  rejectionReason: string | null;
}

interface ShipmentInfo {
  recipientName: string;
  recipientPhone: string;
  address: string;
  destinationDistrictName: string;
  courier: string;
  service: string | null;
  cost: string | null;
  trackingNumber: string | null;
}

interface OrderItemInfo {
  quantity: number;
  unitPrice: string;
  productName: string | null;
  variantName: string | null;
}
interface OrderRow {
  id: string;
  orderNumber: number | null;
  status: string;
  salesMode: string;
  paymentType: string;
  fulfilmentMethod: string | null;
  merchandiseSubtotal: string;
  amountPaid: string;
  createdAt: string;
  customerName: string;
  customerPhone: string;
  payment: LatestPayment | null;
  shipment: ShipmentInfo | null;
  items: OrderItemInfo[];
}

const columnHelper = createColumnHelper<OrderRow>();

const STAT_TONE_CLASSES = {
  warning: "text-amber-600",
  info: "text-blue-600",
  success: "text-green-600",
} as const;

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: keyof typeof STAT_TONE_CLASSES;
}) {
  return (
    <Card className="py-4 gap-1">
      <CardContent className="px-4">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className={`text-2xl font-bold tracking-tight mt-1 ${tone ? STAT_TONE_CLASSES[tone] : ""}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

export default function AdminDashboardPage() {
  const { admin } = useAdminAuth();
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [trackingEntryId, setTrackingEntryId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [fulfilmentFilter, setFulfilmentFilter] = useState("");
  const [labelSender, setLabelSender] = useState<ShippingLabelSender | null>(null);
  const [printQueue, setPrintQueue] = useState<OrderRow[]>([]);
  const [printError, setPrintError] = useState<string | null>(null);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const canManageShipping = admin?.canManageShipping ?? false;

  useEffect(() => {
    if (printQueue.length === 0) return;
    const timer = setTimeout(() => window.print(), 50);
    return () => clearTimeout(timer);
  }, [printQueue]);

  async function handlePrintLabels(ordersToPrint: OrderRow[]) {
    setPrintError(null);
    const shippable = ordersToPrint.filter((o) => o.shipment !== null);
    if (shippable.length === 0) {
      setPrintError("None of the selected orders have shipment details recorded yet.");
      return;
    }

    let sender = labelSender;
    if (!sender) {
      const { data, error } = await supabase.functions.invoke("shipping-label-info");
      if (error || !data?.settings) {
        setPrintError("Couldn't load your shipping settings for the label. Ask an admin to set them in shipping_settings.");
        return;
      }
      sender = {
        name: data.settings.senderName,
        phone: data.settings.senderPhone,
        city: data.settings.originDistrictName,
        address: data.settings.originAddress,
      };
      setLabelSender(sender);
    }

    setPrintQueue(shippable);
  }

  const loadOrders = useCallback(async () => {
    setLoadError(null);
    const { data, error } = await supabase.functions.invoke("list-orders");
    if (error || !data) {
      setLoadError("Couldn't load orders. Please try refreshing.");
      return;
    }
    // Defensive: `items` (and `payment`/`shipment`) exist on list-orders'
    // response only from the version deployed alongside this frontend build.
    // Edge Functions don't redeploy on their own when the frontend does — a
    // stale function still omits `items` entirely, and `openOrder.items.length`
    // below would otherwise crash the whole page instead of just showing an
    // empty list.
    const rows = (data.orders as OrderRow[]).map((row) => ({ ...row, items: row.items ?? [] }));
    setOrders(rows);
  }, []);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  async function handleVerify(orderId: string) {
    setActionError(null);
    setActioningId(orderId);
    const { error } = await supabase.functions.invoke("verify-payment", {
      body: { orderId, decision: "VERIFY" },
    });
    setActioningId(null);
    if (error) {
      setActionError(await functionErrorMessage(error, "Couldn't verify that payment. Please try again."));
      return;
    }
    toast.success("Payment verified");
    await loadOrders();
  }

  async function handleReject(orderId: string, reason: string) {
    setActionError(null);
    setActioningId(orderId);
    const { error } = await supabase.functions.invoke("verify-payment", {
      body: { orderId, decision: "REJECT", rejectionReason: reason },
    });
    setActioningId(null);
    if (error) {
      setActionError(await functionErrorMessage(error, "Couldn't reject that payment. Please try again."));
      return;
    }
    setRejectingId(null);
    toast.success("Payment rejected");
    await loadOrders();
  }

  async function handlePreparePickup(orderId: string) {
    setActionError(null);
    setActioningId(orderId);
    const { error } = await supabase.functions.invoke("prepare-pickup", {
      body: { orderId },
    });
    setActioningId(null);
    if (error) {
      setActionError("Couldn't prepare that order. Please try again.");
      return;
    }
    toast.success("Order marked ready");
    await loadOrders();
  }

  async function handleRecordTracking(
    orderId: string,
    values: { trackingNumber: string; costOverride?: string; costOverrideReason?: string }
  ) {
    setActionError(null);
    setActioningId(orderId);
    const { error } = await supabase.functions.invoke("record-tracking", {
      body: {
        orderId,
        trackingNumber: values.trackingNumber,
        ...(values.costOverride ? { costOverride: Number(values.costOverride), costOverrideReason: values.costOverrideReason } : {}),
      },
    });
    setActioningId(null);
    if (error) {
      setActionError("Couldn't record tracking for that order. Please try again.");
      return;
    }
    setTrackingEntryId(null);
    toast.success("Tracking recorded");
    await loadOrders();
  }

  const columns = useMemo(() => [
    columnHelper.accessor("id", {
      header: "Order",
      cell: ({ row }) => (
        <span className="font-mono text-xs">
          {formatOrderNumber(row.original.fulfilmentMethod, row.original.orderNumber, row.original.id)}
        </span>
      ),
    }),
    columnHelper.accessor("customerName", { header: "Customer" }),
    columnHelper.accessor("salesMode", {
      header: "Mode",
      cell: (info) => <span className="text-xs">{info.getValue() === "PRE_ORDER" ? "Pre-order" : "Ready stock"}</span>,
      meta: { className: "hidden sm:table-cell" },
    }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: (info) => <Badge variant={statusBadgeVariant(info.getValue())}>{info.getValue().replaceAll("_", " ")}</Badge>,
    }),
    columnHelper.accessor("merchandiseSubtotal", {
      header: "Total",
      cell: (info) => formatIDR(info.getValue()),
    }),
    columnHelper.accessor("fulfilmentMethod", {
      header: "Fulfilment",
      cell: (info) => info.getValue() ?? "—",
      meta: { className: "hidden md:table-cell" },
    }),
    columnHelper.display({
      id: "open",
      header: "",
      cell: ({ row }) => (
        <Button type="button" size="sm" variant="outline" onClick={() => setOpenOrderId(row.original.id)}>
          Open
        </Button>
      ),
    }),
  ], []);

  const statusOptions = useMemo(
    () =>
      Array.from(new Set((orders ?? []).map((o) => o.status)))
        .sort()
        .map((s) => ({ label: s.replaceAll("_", " "), value: s })),
    [orders]
  );
  const fulfilmentOptions = useMemo(
    () =>
      Array.from(new Set((orders ?? []).flatMap((o) => (o.fulfilmentMethod ? [o.fulfilmentMethod] : []))))
        .sort()
        .map((v) => ({ label: v, value: v })),
    [orders]
  );

  const stats = useMemo(() => {
    const rows = orders ?? [];
    return {
      total: rows.length,
      needsReview: rows.filter((o) => o.payment?.status === "PENDING").length,
      readyToFulfil: rows.filter((o) =>
        ["READY_FOR_FULFILMENT", "READY_FOR_PICKUP", "READY_TO_SHIP"].includes(o.status)
      ).length,
      completed: rows.filter((o) => ["PICKED_UP", "SHIPPED", "COMPLETED"].includes(o.status)).length,
    };
  }, [orders]);

  const filters: DataTableFilter<OrderRow>[] = [
    {
      label: "All statuses",
      value: statusFilter,
      onChange: setStatusFilter,
      options: statusOptions,
      predicate: (row, value) => row.status === value,
    },
    {
      label: "All fulfilment methods",
      value: fulfilmentFilter,
      onChange: setFulfilmentFilter,
      options: fulfilmentOptions,
      predicate: (row, value) => row.fulfilmentMethod === value,
    },
  ];

  const openOrder = orders?.find((o) => o.id === openOrderId) ?? null;
  const isActioningOpen = openOrder !== null && actioningId === openOrder.id;

  return (
    <AdminLayout>
      <main className="p-4 sm:p-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Orders</h1>
          <p className="text-muted-foreground mt-1">
            Logged in as {admin?.name ?? admin?.email} · disabled actions require a permission you don't have.
          </p>
        </div>

        {orders !== null ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatTile label="Total orders" value={stats.total} />
            <StatTile label="Needs payment review" value={stats.needsReview} tone={stats.needsReview > 0 ? "warning" : undefined} />
            <StatTile label="Ready to fulfil" value={stats.readyToFulfil} tone="info" />
            <StatTile label="Completed" value={stats.completed} tone="success" />
          </div>
        ) : (
          !loadError && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-[70px] rounded-2xl" />
              ))}
            </div>
          )
        )}

        {loadError && (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <p>{loadError}</p>
            <Button type="button" size="sm" variant="outline" onClick={() => void loadOrders()}>
              <RotateCw className="size-3.5" />
              Retry
            </Button>
          </div>
        )}
        {actionError && <p className="text-destructive text-sm">{actionError}</p>}

        {orders === null && !loadError && (
          <Card>
            <CardContent className="pt-6 space-y-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </CardContent>
          </Card>
        )}

        {orders !== null && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>Orders ({orders.length})</CardTitle>
              {fulfilmentFilter === "SHIPPING" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canManageShipping}
                  title={canManageShipping ? undefined : "Requires the Manage shipping permission"}
                  onClick={() => void handlePrintLabels(orders.filter((o) => o.fulfilmentMethod === "SHIPPING"))}
                >
                  Bulk print labels
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {printError && <p className="text-destructive text-sm mb-2">{printError}</p>}
              <DataTable
                columns={columns}
                data={orders}
                emptyMessage="No orders yet."
                searchPlaceholder="Search by customer, phone, or order number…"
                searchableText={(o) => `${o.customerName} ${o.customerPhone} ${o.orderNumber ?? ""} ${o.id}`}
                filters={filters}
              />
            </CardContent>
          </Card>
        )}
      </main>

      {openOrder && (
        <>
          <div className="fixed inset-0 bg-black/45 z-40" onClick={() => setOpenOrderId(null)} />
          <div className="fixed top-0 right-0 bottom-0 w-full sm:w-[440px] bg-card border-l shadow-lg z-50 overflow-y-auto p-6 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-serif font-semibold text-lg">
                  {formatOrderNumber(openOrder.fulfilmentMethod, openOrder.orderNumber, openOrder.id)}
                </p>
                <Badge variant={statusBadgeVariant(openOrder.status)} className="mt-1.5">
                  {openOrder.status.replaceAll("_", " ")}
                </Badge>
              </div>
              <Button type="button" size="icon" variant="ghost" onClick={() => setOpenOrderId(null)}>
                <X className="size-4" />
              </Button>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Customer</p>
              <p className="text-sm font-medium">{openOrder.customerName}</p>
              <p className="text-sm text-muted-foreground">{openOrder.customerPhone}</p>
            </div>

            {openOrder.items.length > 0 && (
              <div className="pt-4 border-t space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Items</p>
                {openOrder.items.map((item, i) => {
                  const label = item.variantName
                    ? `${item.productName ?? "Item"} — ${item.variantName}`
                    : (item.productName ?? "Item");
                  return (
                    <div key={i} className="flex justify-between text-sm gap-2">
                      <span className="truncate">
                        {label} × {item.quantity}
                      </span>
                      <span className="font-medium whitespace-nowrap">
                        {formatIDR((Number(item.unitPrice) * item.quantity).toFixed(2))}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="pt-4 border-t space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Payment</p>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Merchandise total</span>
                <span className="font-medium">{formatIDR(openOrder.merchandiseSubtotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Amount paid</span>
                <span className="font-medium">{formatIDR(openOrder.amountPaid)}</span>
              </div>

              {openOrder.payment ? (
                <>
                  {openOrder.payment.proofUrl ? (
                    <ImageZoom
                      src={openOrder.payment.proofUrl}
                      alt="Payment proof"
                      className="block w-full overflow-hidden rounded-lg border mt-1"
                    />
                  ) : openOrder.payment.proofDeletedAt ? (
                    <p className="text-sm text-muted-foreground">Proof deleted (30-day retention).</p>
                  ) : (
                    <p className="text-sm text-destructive">
                      Couldn't load the proof image — check the Edge Function logs for getSignedProofUrl.
                    </p>
                  )}
                  {openOrder.payment.status === "REJECTED" && openOrder.payment.rejectionReason && (
                    <p className="text-sm text-destructive">Rejected: {openOrder.payment.rejectionReason}</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No payment recorded yet.</p>
              )}

              {rejectingId === openOrder.id ? (
                <div className="pt-1">
                  <PaymentRejectionForm
                    submitting={isActioningOpen}
                    onSubmit={(values) => handleReject(openOrder.id, values.reason)}
                    onCancel={() => setRejectingId(null)}
                  />
                </div>
              ) : (
                openOrder.payment?.status === "PENDING" && (
                  <div className="flex justify-end gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={isActioningOpen || !(admin?.canVerifyPayments ?? false)}
                      title={admin?.canVerifyPayments ? undefined : "Requires the Verify payments permission"}
                      onClick={() => setRejectingId(openOrder.id)}
                    >
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      variant="success"
                      disabled={isActioningOpen || !(admin?.canVerifyPayments ?? false)}
                      title={admin?.canVerifyPayments ? undefined : "Requires the Verify payments permission"}
                      onClick={() => handleVerify(openOrder.id)}
                    >
                      {isActioningOpen ? "Verifying…" : "Verify"}
                    </Button>
                  </div>
                )
              )}
            </div>

            {openOrder.shipment && (
              <div className="pt-4 border-t space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Shipment</p>
                <p className="text-sm">
                  <span className="font-medium">{openOrder.shipment.recipientName}</span> — {openOrder.shipment.recipientPhone}
                </p>
                <p className="text-sm text-muted-foreground">
                  {openOrder.shipment.address}, {openOrder.shipment.destinationDistrictName}
                </p>
                <p className="text-sm text-muted-foreground">
                  {openOrder.shipment.courier}
                  {openOrder.shipment.service ? ` — ${openOrder.shipment.service}` : ""} · {formatIDR(openOrder.shipment.cost ?? "0")}
                </p>
                {openOrder.shipment.trackingNumber && (
                  <p className="text-sm font-mono">Tracking: {openOrder.shipment.trackingNumber}</p>
                )}

                {trackingEntryId === openOrder.id && (
                  <div className="pt-1">
                    <TrackingForm
                      currentCost={openOrder.shipment.cost}
                      submitting={isActioningOpen}
                      onSubmit={(values) => handleRecordTracking(openOrder.id, values)}
                      onCancel={() => setTrackingEntryId(null)}
                    />
                  </div>
                )}

                {trackingEntryId !== openOrder.id && (
                  <div className="flex justify-end gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canManageShipping}
                      title={canManageShipping ? undefined : "Requires the Manage shipping permission"}
                      onClick={() => void handlePrintLabels([openOrder])}
                    >
                      <Printer className="size-3.5" />
                      Print label
                    </Button>
                    {!openOrder.shipment.trackingNumber && openOrder.status === "READY_TO_SHIP" && (
                      <Button
                        size="sm"
                        variant="info"
                        disabled={!canManageShipping}
                        title={canManageShipping ? undefined : "Requires the Manage shipping permission"}
                        onClick={() => setTrackingEntryId(openOrder.id)}
                      >
                        Record tracking
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}

            {openOrder.status === "READY_FOR_FULFILMENT" && (
              <div className="pt-4 border-t flex justify-end">
                <Button
                  size="sm"
                  variant="info"
                  disabled={
                    isActioningOpen ||
                    !(openOrder.fulfilmentMethod === "SHIPPING"
                      ? admin?.canManageShipping ?? false
                      : admin?.canScanConfirmPickup ?? false)
                  }
                  onClick={() => handlePreparePickup(openOrder.id)}
                >
                  {isActioningOpen ? "Preparing…" : openOrder.fulfilmentMethod === "SHIPPING" ? "Prepare for shipment" : "Prepare for pickup"}
                </Button>
              </div>
            )}
          </div>
        </>
      )}

      <div id="print-labels-root">
        {labelSender &&
          printQueue.map((order) =>
            order.shipment ? (
              <ShippingLabel key={order.id} sender={labelSender} order={{ ...order, shipment: order.shipment }} />
            ) : null
          )}
      </div>
    </AdminLayout>
  );
}
