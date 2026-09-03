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

      for (const order of promoted) {
        await tx.update(orders).set({ stockReservedAt: new Date() }).where(eq(orders.id, order.orderId));
      }

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
