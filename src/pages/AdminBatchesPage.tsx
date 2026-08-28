import { useEffect, useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "@/lib/supabaseClient";
import { useAdminAuth } from "@/lib/adminAuth";
import { formatIDR } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import AdminLayout from "@/components/AdminLayout";

const BATCH_STATUSES = [
  "DRAFT",
  "OPEN",
  "CLOSED",
  "PROCUREMENT",
  "AWAITING_STOCK",
  "RECEIVED",
  "FULFILMENT",
  "COMPLETED",
] as const;

const batchSchema = z
  .object({
    name: z.string().trim().min(1, "Batch name is required."),
    openAt: z.string().min(1, "Open date/time is required."),
    closeAt: z.string().min(1, "Close date/time is required."),
    allowDp: z.boolean(),
    allowFull: z.boolean(),
    allowShipping: z.boolean(),
  })
  .refine((v) => v.allowDp || v.allowFull, {
    message: "Allow at least one payment type.",
    path: ["allowFull"],
  });
type BatchValues = z.infer<typeof batchSchema>;

interface ItemDraft {
  variantId: string;
  moq: string;
}

interface RawVariantOption {
  id: string;
  name: string;
  price: string;
  products: { name: string } | null;
}
interface RawBatchItem {
  id: string;
  moq: number | null;
  procured_quantity: number | null;
  product_variants: RawVariantOption;
}
interface RawBatch {
  id: string;
  name: string;
  open_at: string;
  close_at: string;
  status: string;
  allowed_payment_types: string[];
  allowed_fulfilment_methods: string[];
  batch_items: RawBatchItem[];
}
interface RawOrderRow {
  id: string;
  batch_id: string | null;
  status: string;
}
interface RawOrderItemRow {
  order_id: string;
  variant_id: string;
  quantity: number;
}
interface RawInventoryRow {
  variant_id: string;
  on_hand: number;
  reserved: number;
}

export default function AdminBatchesPage() {
  const { admin } = useAdminAuth();
  const canManage = admin?.canManageProductsBatches ?? false;
  const canAdjustInventory = admin?.canAdjustInventory ?? false;
  const [variantOptions, setVariantOptions] = useState<RawVariantOption[] | null>(null);
  const [batches, setBatches] = useState<RawBatch[] | null>(null);
  const [inventoryByVariant, setInventoryByVariant] = useState<Map<string, { onHand: number; reserved: number }>>(
    new Map()
  );
  const [committedByBatchVariant, setCommittedByBatchVariant] = useState<Map<string, Map<string, number>>>(new Map());

  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<Record<string, ItemDraft>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [receiptDrafts, setReceiptDrafts] = useState<Record<string, string>>({});
  const [receiptBusyId, setReceiptBusyId] = useState<string | null>(null);
  const [receiptMessage, setReceiptMessage] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<BatchValues>({
    resolver: zodResolver(batchSchema),
    defaultValues: { allowDp: true, allowFull: true, allowShipping: false },
  });

  const loadAll = useCallback(async () => {
    setLoadError(null);

    const [variantsResult, batchesResult] = await Promise.all([
      supabase.from("product_variants").select("id, name, price, products(name)").order("name"),
      supabase
        .from("batches")
        .select(
          "id, name, open_at, close_at, status, allowed_payment_types, allowed_fulfilment_methods, batch_items(id, moq, procured_quantity, product_variants(id, name, price, products(name)))"
        )
        .order("created_at", { ascending: false }),
    ]);

    if (variantsResult.error || batchesResult.error) {
      setLoadError("Couldn't load products/batches. Please try refreshing.");
      return;
    }

    const rawVariants = ((variantsResult.data as unknown) as RawVariantOption[] | null) ?? [];
    const rawBatches = ((batchesResult.data as unknown) as RawBatch[] | null) ?? [];
    setVariantOptions(rawVariants);
    setBatches(rawBatches);

    const allVariantIds = [...new Set(rawBatches.flatMap((b) => b.batch_items.map((i) => i.product_variants.id)))];

    const [inventoryResult, ordersResult] = await Promise.all([
      allVariantIds.length > 0
        ? supabase.from("inventory").select("variant_id, on_hand, reserved").in("variant_id", allVariantIds)
        : Promise.resolve({ data: [] as RawInventoryRow[] }),
      supabase
        .from("orders")
        .select("id, batch_id, status")
        .in(
          "batch_id",
          rawBatches.map((b) => b.id)
        ),
    ]);

    setInventoryByVariant(
      new Map(
        ((inventoryResult.data as RawInventoryRow[] | null) ?? []).map((row) => [
          row.variant_id,
          { onHand: row.on_hand, reserved: row.reserved },
        ])
      )
    );

    const orderRows = (ordersResult.data as RawOrderRow[] | null) ?? [];
    const relevantOrderIds = orderRows.filter((o) => o.status !== "CANCELLED").map((o) => o.id);
    const orderIdToBatchId = new Map(orderRows.map((o) => [o.id, o.batch_id]));

    const { data: itemRows } =
      relevantOrderIds.length > 0
        ? await supabase.from("order_items").select("order_id, variant_id, quantity").in("order_id", relevantOrderIds)
        : { data: [] as RawOrderItemRow[] };

    const committed = new Map<string, Map<string, number>>();
    for (const row of (itemRows as RawOrderItemRow[] | null) ?? []) {
      const batchId = orderIdToBatchId.get(row.order_id);
      if (!batchId) continue;
      const perVariant = committed.get(batchId) ?? new Map<string, number>();
      perVariant.set(row.variant_id, (perVariant.get(row.variant_id) ?? 0) + row.quantity);
      committed.set(batchId, perVariant);
    }
    setCommittedByBatchVariant(committed);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  function toggleItem(variantId: string, checked: boolean) {
    setSelectedItems((prev) => {
      const next = { ...prev };
      if (checked) next[variantId] = { variantId, moq: "" };
      else delete next[variantId];
      return next;
    });
  }

  function updateItemMoq(variantId: string, moq: string) {
    setSelectedItems((prev) => ({ ...prev, [variantId]: { ...prev[variantId], moq } }));
  }

  async function onSubmit(values: BatchValues) {
    setSubmitError(null);

    const items = Object.values(selectedItems);
    if (items.length === 0) {
      setSubmitError("Select at least one product/variant for this batch.");
      return;
    }

    const allowedPaymentTypes = [...(values.allowDp ? ["DP"] : []), ...(values.allowFull ? ["FULL"] : [])];
    const allowedFulfilmentMethods = ["PICKUP", ...(values.allowShipping ? ["SHIPPING"] : [])];

    setSubmitting(true);
    try {
      const { data: batch, error: batchError } = await supabase
        .from("batches")
        .insert({
          name: values.name,
          open_at: new Date(values.openAt).toISOString(),
          close_at: new Date(values.closeAt).toISOString(),
          status: "DRAFT",
          allowed_payment_types: allowedPaymentTypes,
          allowed_fulfilment_methods: allowedFulfilmentMethods,
        })
        .select()
        .single();
      if (batchError || !batch) throw new Error("Couldn't create the batch.");

      const { error: itemsError } = await supabase.from("batch_items").insert(
        items.map((item) => ({
          batch_id: batch.id,
          variant_id: item.variantId,
          moq: item.moq.trim() ? Number(item.moq) : null,
        }))
      );
      if (itemsError) throw new Error("Batch was created, but adding its items failed — check Drizzle Studio.");

      reset();
      setSelectedItems({});
      await loadAll();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong creating the batch.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStatusChange(batchId: string, status: string) {
    await supabase.from("batches").update({ status }).eq("id", batchId);
    await loadAll();
  }

  async function handleRecordReceipt(batchItemId: string) {
    const raw = receiptDrafts[batchItemId];
    const quantityReceived = Number(raw);
    if (!raw || !Number.isInteger(quantityReceived) || quantityReceived <= 0) {
      setReceiptError("Enter a whole number greater than zero.");
      return;
    }

    setReceiptError(null);
    setReceiptMessage(null);
    setReceiptBusyId(batchItemId);

    const { data, error } = await supabase.functions.invoke("record-batch-receipt", {
      body: { batchItemId, quantityReceived },
    });

    setReceiptBusyId(null);

    if (error || !data) {
      setReceiptError("Couldn't record that receipt. Please try again.");
      return;
    }

    setReceiptMessage(
      `Recorded ${data.received} units. ${data.promoted} order(s) promoted, ${data.stillWaiting} still waiting.`
    );
    setReceiptDrafts((prev) => ({ ...prev, [batchItemId]: "" }));
    await loadAll();
  }

  return (
    <AdminLayout>
    <main className="p-4 sm:p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Admin — Batches</h1>
        <p className="text-muted-foreground mt-1">
          Create a pre-order batch from existing products (Admin — Products). No login yet (§18.4 lands
          in Milestone 4) — internal testing only.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New batch</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label htmlFor="name" className="text-sm font-medium">
                Batch name <span className="text-destructive">*</span>
              </label>
              <input
                id="name"
                {...register("name")}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                placeholder="e.g. Q3 Hoodie Drop"
              />
              {errors.name && <p className="text-destructive text-xs mt-1">{errors.name.message}</p>}
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <label htmlFor="openAt" className="text-sm font-medium">
                  Opens <span className="text-destructive">*</span>
                </label>
                <input
                  id="openAt"
                  type="datetime-local"
                  {...register("openAt")}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                />
                {errors.openAt && <p className="text-destructive text-xs mt-1">{errors.openAt.message}</p>}
              </div>
              <div className="flex-1">
                <label htmlFor="closeAt" className="text-sm font-medium">
                  Closes <span className="text-destructive">*</span>
                </label>
                <input
                  id="closeAt"
                  type="datetime-local"
                  {...register("closeAt")}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                />
                {errors.closeAt && <p className="text-destructive text-xs mt-1">{errors.closeAt.message}</p>}
              </div>
            </div>

            <div>
              <p className="text-sm font-medium">Payment types allowed</p>
              <div className="mt-1 flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" {...register("allowDp")} /> DP (50% deposit)
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" {...register("allowFull")} /> Full payment
                </label>
              </div>
              {errors.allowFull && <p className="text-destructive text-xs mt-1">{errors.allowFull.message}</p>}
            </div>

            <div>
              <p className="text-sm font-medium">Fulfilment</p>
              <div className="mt-1 flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-1.5 text-gray-400">
                  <input type="checkbox" checked disabled /> Pickup (always on)
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" {...register("allowShipping")} /> Also allow shipping
                </label>
              </div>
              <p className="text-xs text-amber-700 mt-1">
                Shipping isn't functional yet (Milestone 3) — checking this only records the intent; checkout
                will still only offer pickup for now.
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Products in this batch</p>
              {variantOptions === null && <p className="text-gray-500 text-sm">Loading products…</p>}
              {variantOptions !== null && variantOptions.length === 0 && (
                <p className="text-gray-500 text-sm">
                  No products yet — create one on the Admin — Products screen first.
                </p>
              )}
              <div className="space-y-1.5">
                {variantOptions?.map((variant) => {
                  const selected = selectedItems[variant.id];
                  return (
                    <div key={variant.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!!selected}
                        onChange={(e) => toggleItem(variant.id, e.target.checked)}
                      />
                      <span className="flex-1">
                        {variant.products?.name ?? "Product"} — {variant.name} ({formatIDR(variant.price)})
                      </span>
                      {selected && (
                        <input
                          value={selected.moq}
                          onChange={(e) => updateItemMoq(variant.id, e.target.value)}
                          placeholder="MOQ"
                          inputMode="numeric"
                          className="w-20 rounded-md border bg-background px-2 py-1 text-xs"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {submitError && <p className="text-destructive text-sm">{submitError}</p>}

            <Button type="submit" disabled={submitting || !canManage} title={canManage ? undefined : "Requires the Manage products & batches permission"}>
              {submitting ? "Creating…" : "Create batch"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {loadError && (
        <p className="text-destructive text-sm">
          {loadError}{" "}
          <button type="button" className="underline" onClick={() => void loadAll()}>
            Retry
          </button>
        </p>
      )}
      {receiptError && <p className="text-destructive text-sm">{receiptError}</p>}
      {receiptMessage && <p className="text-green-700 text-sm">{receiptMessage}</p>}

      {batches === null && !loadError && <p className="text-gray-500 text-sm">Loading batches…</p>}

      {batches?.map((batch) => (
        <Card key={batch.id}>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle>{batch.name}</CardTitle>
              <p className="text-xs text-gray-500 mt-1">
                {new Date(batch.open_at).toLocaleString("id-ID")} → {new Date(batch.close_at).toLocaleString("id-ID")}
                {" · "}
                {batch.allowed_payment_types.join("/")}
                {" · "}
                {batch.allowed_fulfilment_methods.join("+")}
              </p>
            </div>
            <div className="text-right">
              <select
                value={batch.status}
                onChange={(e) => handleStatusChange(batch.id, e.target.value)}
                disabled={!canManage}
                title={canManage ? undefined : "Requires the Manage products & batches permission"}
                className="rounded-md border bg-background px-2 py-1 text-xs disabled:opacity-50"
              >
                {BATCH_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-gray-500 mt-1 max-w-[160px]">
                {batch.status === "OPEN" ? "Visible to customers now." : "Only OPEN batches show at checkout."}
              </p>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {batch.batch_items.map((item) => {
              const stock = inventoryByVariant.get(item.product_variants.id);
              const committed = committedByBatchVariant.get(batch.id)?.get(item.product_variants.id) ?? 0;
              const moqExceeded = item.moq != null && committed > item.moq;
              return (
                <div key={item.id} className="flex items-center justify-between gap-3 border-t pt-3 first:border-0 first:pt-0 text-sm">
                  <div>
                    <p className="font-medium">
                      {item.product_variants.products?.name ?? "Product"} — {item.product_variants.name}
                    </p>
                    <p className="text-gray-500">
                      Ordered: {committed}
                      {item.moq != null && ` / MOQ ${item.moq}`}
                      {moqExceeded && (
                        <Badge variant="warning" className="ml-1">
                          over MOQ
                        </Badge>
                      )}
                      {" · "}
                      On hand: {stock?.onHand ?? 0} · Reserved: {stock?.reserved ?? 0}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      value={receiptDrafts[item.id] ?? ""}
                      onChange={(e) => setReceiptDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                      placeholder="Qty received"
                      inputMode="numeric"
                      className="w-24 rounded-md border bg-background px-2 py-1 text-xs"
                    />
                    <Button
                      size="sm"
                      variant="info"
                      disabled={receiptBusyId === item.id || !canAdjustInventory}
                      title={canAdjustInventory ? undefined : "Requires the Adjust inventory permission"}
                      onClick={() => handleRecordReceipt(item.id)}
                    >
                      {receiptBusyId === item.id ? "Recording…" : "Record receipt"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </main>
    </AdminLayout>
  );
}
