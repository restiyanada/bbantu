import { useEffect, useState, useCallback, useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";
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
        if (!payment) return <span className="text-gray-400 text-sm">—</span>;
        if (!payment.proofUrl) {
          return <span className="text-gray-400 text-sm">Expired</span>;
        }
        return (
          <Dialog>
            <DialogTrigger asChild>
              <button type="button" className="text-xs text-blue-600 underline">
                View
              </button>
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
        if (!shipment) return <span className="text-gray-400 text-sm">—</span>;
        return (
          <Dialog>
            <DialogTrigger asChild>
              <button type="button" className="text-xs text-blue-600 underline">
                View
              </button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Shipment details</DialogTitle>
              </DialogHeader>
              <div className="text-sm space-y-1">
                <p>
                  <span className="font-medium">{shipment.recipientName}</span> — {shipment.recipientPhone}
                </p>
                <p className="text-gray-600">
                  {shipment.address}, {shipment.destinationDistrictName}
                </p>
                <p className="text-gray-600 pt-2 mt-2 border-t">
                  {shipment.courier}
                  {shipment.service ? ` — ${shipment.service}` : ""} · {formatIDR(shipment.cost ?? "0")}
                </p>
                {shipment.trackingNumber && (
                  <p className="font-mono text-xs">Tracking: {shipment.trackingNumber}</p>
                )}
              </div>
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
              <button
                type="button"
                className="text-xs text-gray-500 underline"
                onClick={() => setRejectingId(null)}
              >
                Cancel
              </button>
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
              <button
                type="button"
                className="text-xs text-gray-500 underline"
                onClick={() => setTrackingEntryId(null)}
              >
                Cancel
              </button>
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
          // Same underlying prepare-pickup Edge Function handles both —
          // it already branches on fulfilmentMethod internally (Milestone 1
          // designed READY_FOR_PICKUP/READY_TO_SHIP as siblings under one
          // PREPARE_FOR_FULFILMENT event). Only the label differs here.
          // Permission mirrors the Edge Function's own split (§18.4):
          // shipping orders need canManageShipping, pickup orders need
          // canScanConfirmPickup.
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

        return <span className="text-gray-400 text-sm">—</span>;
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
          <h1 className="text-2xl font-semibold">Admin — Orders</h1>
          <p className="text-muted-foreground mt-1">
            Logged in as {admin?.name ?? admin?.email} · disabled actions require a permission you don't have (§18.4).
          </p>
        </div>

        {loadError && (
          <p className="text-destructive text-sm">
            {loadError}{" "}
            <button type="button" className="underline" onClick={() => void loadOrders()}>
              Retry
            </button>
          </p>
        )}
        {actionError && <p className="text-destructive text-sm">{actionError}</p>}

        {orders === null && !loadError && <p className="text-gray-500 text-sm">Loading orders…</p>}

        {orders !== null && (
          <Card>
            <CardHeader>
              <CardTitle>Orders ({orders.length})</CardTitle>
            </CardHeader>
            <CardContent>
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
    </AdminLayout>
  );
}
