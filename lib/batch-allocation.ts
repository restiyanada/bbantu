/**
 * Batch receipt allocation — PRD §26 MOQ-shortfall rule (Milestone 2).
 *
 * When a supplier receipt doesn't cover every pre-order waiting on that
 * variant, orders are promoted in the order their payment was verified
 * (earliest first) — not order-submission time, not arbitrary. A multi-item
 * order is only promoted once every one of its items is simultaneously
 * coverable; it is never partially fulfilled (see architecture note below).
 *
 * Pure decision logic, no DB access — mirrors how lib/order-state-machine.ts
 * separates "what should happen" from lib/orders.ts's "how it's written to
 * the DB". Called from supabase/functions/record-batch-receipt whenever
 * admin logs a supplier receipt for one batch item.
 *
 * Why all-or-nothing per order: if an order contains a hoodie (just arrived)
 * and a tote bag (still incoming), reserving the hoodie for it would lock
 * that unit away from a different, later order that only wants a hoodie.
 * The stuck order simply keeps waiting — a later single-item order can and
 * should be promoted ahead of it. This isn't spelled out verbatim in the
 * PRD; flagged here as the interpretation this code implements.
 */

export interface WaitingOrderItem {
  variantId: string;
  quantity: number;
}

export interface WaitingOrder {
  orderId: string;
  /** When this order's payment was verified — the §26 ranking key. */
  reservedAt: Date;
  items: WaitingOrderItem[];
}

export interface VariantStock {
  onHand: number;
  reserved: number;
}

export interface AllocationResult {
  /** Orders that can be fully covered right now, oldest-verified first. */
  promoted: WaitingOrder[];
  /** Orders left waiting — either no stock moved for them, or one of their
   * other items still hasn't arrived. */
  stillWaiting: WaitingOrder[];
  /** Additional `inventory.reserved` to write per variant, summed across every promoted order. */
  reservedDeltaByVariant: Map<string, number>;
}

/**
 * @param waitingOrders Every order in `AWAITING_STOCK` for this batch that
 *   includes at least the variant a receipt was just recorded for. Order of
 *   this array doesn't matter — it's sorted internally by `reservedAt`.
 * @param stockByVariant Current on-hand/reserved for every variant that
 *   appears in any of `waitingOrders`' items (not just the one that was just
 *   received) — an order can only be promoted once *all* its items clear.
 */
export function allocateReceivedStock(
  waitingOrders: WaitingOrder[],
  stockByVariant: ReadonlyMap<string, VariantStock>
): AllocationResult {
  const sorted = [...waitingOrders].sort((a, b) => a.reservedAt.getTime() - b.reservedAt.getTime());

  // Running available-per-variant, decremented as each order is promoted —
  // this running total (not the original snapshot) is what lets a later,
  // easier-to-satisfy order jump ahead of an earlier order still stuck on a
  // different missing item.
  const available = new Map<string, number>();
  for (const [variantId, stock] of stockByVariant) {
    available.set(variantId, stock.onHand - stock.reserved);
  }

  const promoted: WaitingOrder[] = [];
  const stillWaiting: WaitingOrder[] = [];
  const reservedDeltaByVariant = new Map<string, number>();

  for (const order of sorted) {
    const canFulfillEveryItem = order.items.every(
      (item) => (available.get(item.variantId) ?? 0) >= item.quantity
    );

    if (!canFulfillEveryItem) {
      stillWaiting.push(order);
      continue;
    }

    for (const item of order.items) {
      available.set(item.variantId, (available.get(item.variantId) ?? 0) - item.quantity);
      reservedDeltaByVariant.set(
        item.variantId,
        (reservedDeltaByVariant.get(item.variantId) ?? 0) + item.quantity
      );
    }
    promoted.push(order);
  }

  return { promoted, stillWaiting, reservedDeltaByVariant };
}
