/**
 * Order transition orchestration — wraps `transition()` (lib/order-state-machine.ts)
 * with the actual DB read/write, inside one transaction, per PRD §20 ("nothing
 * changes status without being logged").
 *
 * This file only knows how to move an order from one status to another and
 * log it. It does not decide *when* to call transition — that's the caller's
 * job (an Edge Function deciding "payment was just verified, so transition
 * this order").
 */

import { eq } from "drizzle-orm";
import { orders } from "../db/schema.ts";
import { transition, type OrderContext, type OrderEvent, type OrderStatus } from "./order-state-machine.ts";
import { logAudit, type AuditWriter } from "./audit.ts";

/**
 * Minimal shape a drizzle transaction needs for this module. Typed structurally
 * (rather than against a concrete driver's transaction class) so the same
 * orchestration code runs unmodified under both the Node/postgres-js driver
 * (Vitest) and the Deno/postgres-js driver (Edge Functions) — see
 * architecture.md "Shared code across Node and Deno".
 */
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
  /** Admin user performing this action, or null for system/customer-triggered events. */
  actorId: string | null;
  /**
   * Whether on-hand inventory currently covers this order's reserved quantity.
   * Required (not defaulted) because it drives a real branch in the state
   * machine (RESERVED/AWAITING_STOCK → BALANCE_DUE or READY_FOR_FULFILMENT) —
   * getting this wrong silently skips a stock-readiness check, so callers
   * must compute and pass it explicitly rather than relying on a default.
   * For ready-stock orders (Milestone 1) this is always `true`: stock is
   * on hand by definition before the order can be placed.
   */
  stockAvailable: boolean;
}

export interface TransitionOrderResult {
  from: OrderStatus;
  to: OrderStatus;
}

/**
 * Reads the order (locked FOR UPDATE so concurrent transitions on the same
 * order serialize instead of racing), computes the next status via
 * `transition()`, writes it, and logs the audit row — all inside the
 * transaction the caller opened. The caller is responsible for calling this
 * inside `db.transaction(async (tx) => { ... })`.
 */
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
