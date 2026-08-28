import { useEffect, useState, useCallback, useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { Eye, RotateCw } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useAdminAuth } from "@/lib/adminAuth";
import { formatIDR, formatOrderNumber, statusBadgeVariant } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PaymentRejectionForm } from "@/components/payment-rejection-form";
import { TrackingForm } from "@/components/tracking-form";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DataTable, type DataTableFilter } from "@/components/data-table";
import AdminLayout from "@/components/AdminLayout";
import { ShippingLabel, type ShippingLabelSender } from "@/components/shipping-label";

interface LatestPayment {
  id: string;
  status: string;
  amount: string;
  proofUrl: string | null;
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
}

const columnHelper = createColumnHelper<OrderRow>();

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
    setOrders(data.orders as OrderRow[]);
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
      setActionError("Couldn't verify that payment. Please try again.");
      return;
    }
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
      setActionError("Couldn't reject that payment. Please try again.");
      return;
    }
    setRejectingId(null);
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
    await loadOrders();
  }

  const columns = [
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
    }),
    columnHelper.display({
      id: "proof",
      header: "Proof",
      cell: ({ row }) => {
        const payment = row.original.payment;
        if (!payment) return <span className="text-muted-foreground text-sm">—</span>;
        if (!payment.proofUrl) {
          return <span className="text-muted-foreground text-sm">Expired</span>;
        }
        return (
          <Dialog>
            <DialogTrigger asChild>
              <Button type="button" size="sm" variant="outline">
                <Eye className="size-3.5" />
                View
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Payment proof — {payment.status.replaceAll("_", " ")}</DialogTitle>
              </DialogHeader>
              <img src={payment.proofUrl} alt="Payment proof" className="w-full rounded-md" />
              {payment.status === "REJECTED" && payment.rejectionReason && (
                <p className="text-sm text-destructive">Rejected: {payment.rejectionReason}</p>
              )}
            </DialogContent>
          </Dialog>
        );
      },
    }),
    columnHelper.display({
      id: "shipment",
      header: "Shipping",
      cell: ({ row }) => {
        const shipment = row.original.shipment;
        if (!shipment) return <span className="text-muted-foreground text-sm">—</span>;
        return (
          <Dialog>
            <DialogTrigger asChild>
              <Button type="button" size="sm" variant="outline">
                <Eye className="size-3.5" />
                View
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Shipment details</DialogTitle>
              </DialogHeader>
              <div className="text-sm space-y-1">
                <p>
                  <span className="font-medium">{shipment.recipientName}</span> — {shipment.recipientPhone}
                </p>
                <p className="text-muted-foreground">
                  {shipment.address}, {shipment.destinationDistrictName}
                </p>
                <p className="text-muted-foreground pt-2 mt-2 border-t">
                  {shipment.courier}
                  {shipment.service ? ` — ${shipment.service}` : ""} · {formatIDR(shipment.cost ?? "0")}
                </p>
                {shipment.trackingNumber && (
                  <p className="font-mono text-xs">Tracking: {shipment.trackingNumber}</p>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={!canManageShipping}
                title={canManageShipping ? undefined : "Requires the Manage shipping permission"}
                onClick={() => void handlePrintLabels([row.original])}
              >
                Print label
              </Button>
            </DialogContent>
          </Dialog>
        );
      },
    }),
    columnHelper.display({
      id: "actions",
      header: "Actions",
      cell: ({ row }) => {
        const order = row.original;
        const isActioning = actioningId === order.id;

        if (rejectingId === order.id) {
          return (
            <div className="space-y-2">
              <PaymentRejectionForm
                submitting={isActioning}
                onSubmit={(values) => handleReject(order.id, values.reason)}
              />
              <Button type="button" size="sm" variant="ghost" onClick={() => setRejectingId(null)}>
                Cancel
              </Button>
            </div>
          );
        }

        if (trackingEntryId === order.id) {
          return (
            <div className="space-y-2">
              <TrackingForm
                currentCost={order.shipment?.cost ?? null}
                submitting={isActioning}
                onSubmit={(values) => handleRecordTracking(order.id, values)}
              />
              <Button type="button" size="sm" variant="ghost" onClick={() => setTrackingEntryId(null)}>
                Cancel
              </Button>
            </div>
          );
        }

        if (order.payment?.status === "PENDING") {
          const canVerify = admin?.canVerifyPayments ?? false;
          return (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="success"
                disabled={isActioning || !canVerify}
                title={canVerify ? undefined : "Requires the Verify payments permission"}
                onClick={() => handleVerify(order.id)}
              >
                {isActioning ? "Verifying…" : "Verify"}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={isActioning || !canVerify}
                title={canVerify ? undefined : "Requires the Verify payments permission"}
                onClick={() => setRejectingId(order.id)}
              >
                Reject
              </Button>
            </div>
          );
        }

        if (order.status === "READY_FOR_FULFILMENT") {
          const isShipping = order.fulfilmentMethod === "SHIPPING";
          const label = isShipping ? "Prepare for shipment" : "Prepare for pickup";
          const canPrepare = isShipping ? admin?.canManageShipping ?? false : admin?.canScanConfirmPickup ?? false;
          return (
            <Button
              size="sm"
              variant="info"
              disabled={isActioning || !canPrepare}
              title={canPrepare ? undefined : "Requires the Manage shipping / Scan-confirm pickup permission"}
              onClick={() => handlePreparePickup(order.id)}
            >
              {isActioning ? "Preparing…" : label}
            </Button>
          );
        }

        if (order.status === "READY_TO_SHIP") {
          const canManageShipping = admin?.canManageShipping ?? false;
          return (
            <Button
              size="sm"
              variant="info"
              disabled={!canManageShipping}
              title={canManageShipping ? undefined : "Requires the Manage shipping permission"}
              onClick={() => setTrackingEntryId(order.id)}
            >
              Record tracking
            </Button>
          );
        }

        return <span className="text-muted-foreground text-sm">—</span>;
      },
    }),
  ];

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

  return (
    <AdminLayout>
      <main className="p-4 sm:p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Orders</h1>
          <p className="text-muted-foreground mt-1">
            Logged in as {admin?.name ?? admin?.email} · disabled actions require a permission you don't have (§18.4).
          </p>
        </div>

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

        {orders === null && !loadError && <p className="text-muted-foreground text-sm">Loading orders…</p>}

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
