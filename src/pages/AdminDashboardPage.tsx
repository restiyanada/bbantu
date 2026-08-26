import { useEffect, useState, useCallback } from "react";
import {
  useReactTable,
  getCoreRowModel,
  createColumnHelper,
  flexRender,
} from "@tanstack/react-table";
import { supabase } from "@/lib/supabaseClient";
import { formatIDR } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PaymentRejectionForm } from "@/components/payment-rejection-form";

// ⚠️ NOT SECURE YET — this page has no login and no permission checks
// (Milestone 4 adds real Supabase Auth + the §18.4 per-action toggles).
// It calls list-orders/verify-payment/prepare-pickup directly with the
// public anon key. Don't link this page anywhere public yet.

interface PendingPayment {
  id: string;
  status: string;
  amount: string;
}

interface OrderRow {
  id: string;
  status: string;
  salesMode: string;
  paymentType: string;
  fulfilmentMethod: string | null;
  merchandiseSubtotal: string;
  amountPaid: string;
  createdAt: string;
  customerName: string;
  customerPhone: string;
  pendingPayment: PendingPayment | null;
}

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "CANCELLED" || status === "REFUND_REQUIRED") return "destructive";
  if (status === "COMPLETED" || status === "PICKED_UP" || status === "SHIPPED") return "default";
  return "secondary";
}

const columnHelper = createColumnHelper<OrderRow>();

export default function AdminDashboardPage() {
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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
      setActionError("Couldn't prepare that order for pickup. Please try again.");
      return;
    }
    await loadOrders();
  }

  const columns = [
    columnHelper.accessor("id", {
      header: "Order",
      cell: (info) => <span className="font-mono text-xs">{info.getValue().slice(0, 8)}</span>,
    }),
    columnHelper.accessor("customerName", { header: "Customer" }),
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

        if (order.pendingPayment) {
          return (
            <div className="flex gap-2">
              <Button size="sm" disabled={isActioning} onClick={() => handleVerify(order.id)}>
                {isActioning ? "Verifying…" : "Verify"}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={isActioning}
                onClick={() => setRejectingId(order.id)}
              >
                Reject
              </Button>
            </div>
          );
        }

        if (order.status === "READY_FOR_FULFILMENT") {
          return (
            <Button size="sm" disabled={isActioning} onClick={() => handlePreparePickup(order.id)}>
              {isActioning ? "Preparing…" : "Prepare for pickup"}
            </Button>
          );
        }

        return <span className="text-gray-400 text-sm">—</span>;
      },
    }),
  ];

  const table = useReactTable({
    data: orders ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <main className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Admin — Orders</h1>
        <p className="text-muted-foreground mt-1">
          No login yet (§18.4 permissions land in Milestone 4) — internal testing only.
        </p>
      </div>

      {loadError && <p className="text-destructive text-sm">{loadError}</p>}
      {actionError && <p className="text-destructive text-sm">{actionError}</p>}

      {orders === null && !loadError && <p className="text-gray-500 text-sm">Loading orders…</p>}

      {orders !== null && (
        <Card>
          <CardHeader>
            <CardTitle>Orders ({orders.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm border rounded-md overflow-hidden">
              <thead className="bg-muted">
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <th key={header.id} className="text-left p-2 font-medium">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="border-t align-top">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="p-2">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
                {orders.length === 0 && (
                  <tr>
                    <td colSpan={columns.length} className="p-4 text-center text-gray-500">
                      No orders yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
