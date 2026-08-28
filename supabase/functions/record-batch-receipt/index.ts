/**
 * POST /record-batch-receipt — admin logs a supplier delivery for one batch
 * line item (§10.3, §11, §26 — Milestone 2).
 *
 * Two things happen in one transaction:
 *
 *   1. Bookkeeping: `inventory.onHand` for that variant goes up by the
 *      received quantity, logged as an inventory_transactions row. No
 *      "publish surplus" gate — surplus becomes sellable ready stock the
 *      moment it's on hand (§12, resolved for Milestone 2: no extra
 *      approval step).
 *   2. Promotion: every order in AWAITING_STOCK for this batch that
 *      includes this variant is a candidate. lib/batch-allocation.ts decides
 *      who actually gets promoted — oldest payment-verification time first
 *      (§26), all-or-nothing per order (a multi-item order only advances
 *      once every one of its items clears, never partially). Promoted
 *      orders fire the existing STOCK_RECEIVED transition (already in
 *      lib/order-state-machine.ts, unchanged since Milestone 1) — DP orders
 *      land on BALANCE_DUE, FULL orders land on READY_FOR_FULFILMENT.
 *
 * This is a bookkeeping event only, not gated on batch.status — an admin
 * can record a receipt whenever goods physically arrive, matching §10.3's
 * "MOQ is informational only" spirit extended to the rest of procurement.
 *
 * Orders that don't get covered simply stay in AWAITING_STOCK — no automatic
 * cancellation (§26 shortfall rule: "remaining orders are cancelled manually
 * by admin", not by this endpoint).
 *
 * Milestone 4: requires a real Supabase Auth session with
 * admin_users.canAdjustInventory — see supabase/functions/_shared/auth.ts.
 */

import { eq, and, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../_shared/db.ts";
import { handleCors } from "../_shared/cors.ts";
import { HttpError, json, errorResponse } from "../_shared/http.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { batchItems, orders, orderItems, inventory, inventoryTransactions, customers } from "../../../db/schema.ts";
import { transitionOrder } from "../../../lib/orders.ts";
import { logAudit } from "../../../lib/audit.ts";
import { queueEmail } from "../../../lib/email-queue.ts";
import { allocateReceivedStock, type WaitingOrder, type VariantStock } from "../../../lib/batch-allocation.ts";

const recordReceiptSchema = z.object({
  batchItemId: z.string().uuid(),
  quantityReceived: z.number().int().positive(),
});

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  let input: z.infer<typeof recordReceiptSchema>;
  try {
    input = recordReceiptSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return json({ error: "Invalid request.", details: err.issues }, 400);
    }
    return json({ error: "Invalid JSON body." }, 400);
  }

  try {
    const admin = await requireAdmin(req, "canAdjustInventory");

    const result = await db.transaction(async (tx) => {
      const [batchItem] = await tx.select().from(batchItems).where(eq(batchItems.id, input.batchItemId));
      if (!batchItem) {
        throw new HttpError(404, "This batch item doesn't exist.");
      }

      // 1. Bookkeeping — add to on-hand. Upsert in case this variant has
      // never had a physical inventory row before (a pre-order-only product
      // that's never existed as ready stock).
      await tx
        .insert(inventory)
        .values({ variantId: batchItem.variantId, onHand: input.quantityReceived, reserved: 0 })
        .onConflictDoUpdate({
          target: inventory.variantId,
          set: { onHand: sql`${inventory.onHand} + ${input.quantityReceived}` },
        });

      await tx.insert(inventoryTransactions).values({
        variantId: batchItem.variantId,
        quantityDelta: input.quantityReceived,
        reason: `Supplier receipt recorded for batch item ${batchItem.id}`,
        createdBy: admin.id,
      });

      await logAudit(tx, {
        actorId: admin.id,
        entityType: "batch_item",
        entityId: batchItem.id,
        action: "supplier receipt recorded",
        after: { quantityReceived: input.quantityReceived },
      });

      // 2. Promotion — every AWAITING_STOCK order in this batch that
      // touches this variant is a candidate; but the all-or-nothing check
      // needs *every* item on each candidate order, not just this one.
      const candidateOrders = await tx
        .select({ id: orders.id, reservedAt: orders.reservedAt })
        .from(orders)
        .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
        .where(
          and(
            eq(orders.batchId, batchItem.batchId),
            eq(orders.status, "AWAITING_STOCK"),
            eq(orderItems.variantId, batchItem.variantId)
          )
        );

      if (candidateOrders.length === 0) {
        // No one's waiting on this variant right now — the receipt still
        // counted for inventory, there's just nothing to promote.
        return { received: input.quantityReceived, promoted: 0, stillWaiting: 0 };
      }

      const orderIds = candidateOrders.map((o) => o.id);
      const allItemRows = await tx.select().from(orderItems).where(inArray(orderItems.orderId, orderIds));

      const itemsByOrder = new Map<string, WaitingOrder["items"]>();
      for (const row of allItemRows) {
        const list = itemsByOrder.get(row.orderId) ?? [];
        list.push({ variantId: row.variantId, quantity: row.quantity });
        itemsByOrder.set(row.orderId, list);
      }

      const waitingOrders: WaitingOrder[] = candidateOrders.map((o) => ({
        orderId: o.id,
        // Every order reaching AWAITING_STOCK was stamped in verify-payment
        // right before — this should never be null in practice, but fall
        // back to "now" (lowest priority) rather than crash if it somehow is.
        reservedAt: o.reservedAt ?? new Date(),
        items: itemsByOrder.get(o.id) ?? [],
      }));

      const involvedVariantIds = [...new Set(allItemRows.map((r) => r.variantId))];
      const stockRows = await tx
        .select()
        .from(inventory)
        .where(inArray(inventory.variantId, involvedVariantIds))
        .for("update");

      const stockByVariant = new Map<string, VariantStock>(
        stockRows.map((row) => [row.variantId, { onHand: row.onHand, reserved: row.reserved }])
      );

      const { promoted, reservedDeltaByVariant } = allocateReceivedStock(waitingOrders, stockByVariant);

      for (const [variantId, delta] of reservedDeltaByVariant) {
        await tx
          .update(inventory)
          .set({ reserved: sql`${inventory.reserved} + ${delta}` })
          .where(eq(inventory.variantId, variantId));

        await tx.insert(inventoryTransactions).values({
          variantId,
          quantityDelta: -delta,
          reason: `Reservation allocated from batch receipt (batch item ${batchItem.id})`,
          createdBy: admin.id,
        });
      }

      // Milestone 5 — one lookup for every promoted order's customer email
      // rather than one query per order in the loop below.
      const promotedCustomerEmailByOrder = new Map<string, string>();
      if (promoted.length > 0) {
        const rows = await tx
          .select({ orderId: orders.id, email: customers.email })
          .from(orders)
          .innerJoin(customers, eq(orders.customerId, customers.id))
          .where(
            inArray(
              orders.id,
              promoted.map((o) => o.orderId)
            )
          );
        for (const row of rows) promotedCustomerEmailByOrder.set(row.orderId, row.email);
      }

      for (const order of promoted) {
        const { to } = await transitionOrder(tx, {
          orderId: order.orderId,
          event: "STOCK_RECEIVED",
          actorId: admin.id,
          stockAvailable: true,
        });

        // §17.1 — P0. If it lands on READY_FOR_FULFILMENT instead (already
        // paid in full), no email here — that order's next and only
        // remaining email is "ready for fulfilment", from prepare-pickup.
        if (to === "BALANCE_DUE") {
          const email = promotedCustomerEmailByOrder.get(order.orderId);
          if (email) {
            await queueEmail(tx, { orderId: order.orderId, toAddress: email, template: "BALANCE_DUE", priority: "P0" });
          }
        }
      }

      return {
        received: input.quantityReceived,
        promoted: promoted.length,
        stillWaiting: candidateOrders.length - promoted.length,
      };
    });

    return json(result);
  } catch (err) {
    return errorResponse(err, "Unexpected error recording the supplier receipt.");
  }
});
