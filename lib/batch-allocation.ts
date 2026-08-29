export interface WaitingOrderItem {
  variantId: string;
  quantity: number;
}

export interface WaitingOrder {
  orderId: string;
  reservedAt: Date;
  items: WaitingOrderItem[];
}

export interface VariantStock {
  onHand: number;
  reserved: number;
}

export interface AllocationResult {
  promoted: WaitingOrder[];
  stillWaiting: WaitingOrder[];
  reservedDeltaByVariant: Map<string, number>;
}

export function allocateReceivedStock(
  waitingOrders: WaitingOrder[],
  stockByVariant: ReadonlyMap<string, VariantStock>
): AllocationResult {
  const sorted = [...waitingOrders].sort((a, b) => a.reservedAt.getTime() - b.reservedAt.getTime());

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
