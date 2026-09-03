import { eq, sql } from "drizzle-orm";
import { orderItems, inventory, inventoryTransactions } from "../db/schema.ts";

export interface ReservationTransaction {
  select(): {
    from(table: typeof orderItems): {
      where(condition: unknown): Promise<Array<typeof orderItems.$inferSelect>>;
    };
  };
  update(table: typeof inventory): {
    set(values: { reserved: unknown }): {
      where(condition: unknown): Promise<unknown>;
    };
  };
  insert(table: typeof inventoryTransactions): {
    values(row: NewInventoryTransactionRow): Promise<unknown>;
  };
}

export interface NewInventoryTransactionRow {
  variantId: string;
  quantityDelta: number;
  reason: string;
  createdBy: string | null;
}

export interface ReleaseReservationParams {
  orderId: string;
  actorId: string | null;
  reason: string;
}

/** Decrements inventory.reserved for every line of the order and writes one
 *  ledger row per variant. Returns the per-variant quantities released.
 *
 *  This mirrors verify-payment's allocation block, inverted: that block
 *  increments `reserved` and writes a negative `quantityDelta` (stock
 *  committed away); a release returns stock, so it decrements `reserved`
 *  and writes the opposite, positive `quantityDelta`.
 *
 *  The caller decides *whether* to release (by checking the order's
 *  stockReservedAt flag) — this helper only performs it. */
export async function releaseReservation(
  tx: ReservationTransaction,
  params: ReleaseReservationParams
): Promise<Array<{ variantId: string; quantity: number }>> {
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, params.orderId));

  const released: Array<{ variantId: string; quantity: number }> = [];

  for (const item of items) {
    await tx
      .update(inventory)
      .set({ reserved: sql`${inventory.reserved} - ${item.quantity}` })
      .where(eq(inventory.variantId, item.variantId));

    await tx.insert(inventoryTransactions).values({
      variantId: item.variantId,
      quantityDelta: item.quantity,
      reason: params.reason,
      createdBy: params.actorId,
    });

    released.push({ variantId: item.variantId, quantity: item.quantity });
  }

  return released;
}
