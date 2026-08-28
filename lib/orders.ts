import { eq } from "drizzle-orm";
import { orders } from "../db/schema.ts";
import { transition, type OrderContext, type OrderEvent, type OrderStatus } from "./order-state-machine.ts";
import { logAudit, type AuditWriter } from "./audit.ts";

export interface OrdersTransaction extends AuditWriter {
  select(): {
    from(table: typeof orders): {
      where(condition: unknown): {
        for(strength: "update"): Promise<Array<typeof orders.$inferSelect>>;
      };
    };
  };
  update(table: typeof orders): {
    set(values: Partial<typeof orders.$inferInsert>): {
      where(condition: unknown): Promise<unknown>;
    };
  };
}

export class OrderNotFoundError extends Error {
  constructor(public readonly orderId: string) {
    super(`Order ${orderId} not found`);
    this.name = "OrderNotFoundError";
  }
}

export interface TransitionOrderParams {
  orderId: string;
  event: OrderEvent;
  actorId: string | null;
  stockAvailable: boolean;
}

export interface TransitionOrderResult {
  from: OrderStatus;
  to: OrderStatus;
}

export async function transitionOrder(
  tx: OrdersTransaction,
  params: TransitionOrderParams
): Promise<TransitionOrderResult> {
  const [order] = await tx
    .select()
    .from(orders)
    .where(eq(orders.id, params.orderId))
    .for("update");

  if (!order) {
    throw new OrderNotFoundError(params.orderId);
  }

  const ctx: OrderContext = {
    paymentType: order.paymentType,
    fulfilmentMethod: order.fulfilmentMethod,
    stockAvailable: params.stockAvailable,
  };

  const from = order.status as OrderStatus;
  const to = transition(from, params.event, ctx);

  await tx.update(orders).set({ status: to }).where(eq(orders.id, params.orderId));

  await logAudit(tx, {
    actorId: params.actorId,
    entityType: "order",
    entityId: params.orderId,
    action: `${params.event}: ${from} -> ${to}`,
    before: { status: from },
    after: { status: to },
  });

  return { from, to };
}
