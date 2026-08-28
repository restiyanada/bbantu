/**
 * Customer-facing order timeline — §16.3.
 *
 * Which steps show, and which are done/current/upcoming, depends on three
 * things about the order: pre-order vs ready stock, full payment vs
 * deposit, pickup vs shipping. Kept as one pure function (no fetching, no
 * React) so it's directly testable, matching how lib/order-state-machine.ts
 * and lib/batch-allocation.ts are structured elsewhere in this project.
 *
 * Deliberately simpler than the full 13-status state machine — several
 * internal statuses (RESERVED, AWAITING_STOCK) don't get their own visible
 * step; they just mean "still on the previous step". See PROGRESS_RANK
 * below for exactly which statuses count as which step being done.
 */

export type OrderStatus =
  | "PAYMENT_PENDING"
  | "PAYMENT_VERIFIED"
  | "RESERVED"
  | "AWAITING_STOCK"
  | "BALANCE_DUE"
  | "READY_FOR_FULFILMENT"
  | "READY_FOR_PICKUP"
  | "PICKED_UP"
  | "READY_TO_SHIP"
  | "SHIPPED"
  | "COMPLETED"
  | "CANCELLED"
  | "REFUND_REQUIRED";

export interface OrderTimelineInput {
  status: OrderStatus;
  salesMode: "PRE_ORDER" | "READY_STOCK";
  paymentType: "DP" | "FULL";
  fulfilmentMethod: "PICKUP" | "SHIPPING" | null;
}

export type TimelineStepState = "done" | "current" | "upcoming";

export interface TimelineStep {
  key: string;
  label: string;
  state: TimelineStepState;
}

export interface OrderTimeline {
  steps: TimelineStep[];
  /**
   * Set only for CANCELLED/REFUND_REQUIRED, shown after the steps instead
   * of continuing them. We deliberately don't try to reconstruct exactly
   * how far a cancelled order got — the orders row only holds its current
   * status, not a history of prior ones, so "Order placed, then
   * Cancelled" is the most this can honestly show without pulling in the
   * audit log (which guests can't read anyway).
   */
  terminalNote: { label: string; tone: "cancelled" | "refund" } | null;
}

/**
 * How far a *normal* (non-cancelled) order has progressed, expressed as
 * the highest step-rank now complete (see the rank values used in
 * buildOrderTimeline below). Statuses not listed here don't add progress
 * beyond "order placed" (rank 0) — currently none are missing, but this
 * fails safe rather than throwing if the state machine ever grows a status
 * this file doesn't know about yet.
 */
const STATUS_DONE_RANK: Record<OrderStatus, number> = {
  PAYMENT_PENDING: 0,
  PAYMENT_VERIFIED: 1,
  RESERVED: 1, // no separate visible step — same displayed progress as PAYMENT_VERIFIED
  AWAITING_STOCK: 1, // still waiting on "stock received"
  BALANCE_DUE: 2, // stock question is resolved by the time this is reached
  READY_FOR_FULFILMENT: 3, // includes "balance paid" for DP orders, which is how this status is reached
  READY_FOR_PICKUP: 4,
  READY_TO_SHIP: 4,
  PICKED_UP: 6,
  SHIPPED: 6,
  COMPLETED: 6,
  CANCELLED: 0, // unused — handled as a special case below
  REFUND_REQUIRED: 0, // unused — handled as a special case below
};

export function buildOrderTimeline(input: OrderTimelineInput): OrderTimeline {
  if (input.status === "CANCELLED" || input.status === "REFUND_REQUIRED") {
    return {
      steps: [{ key: "ORDER_PLACED", label: "Order placed", state: "done" }],
      terminalNote:
        input.status === "CANCELLED"
          ? { label: "Cancelled", tone: "cancelled" }
          : { label: "Refund in progress", tone: "refund" },
    };
  }

  const isPreOrder = input.salesMode === "PRE_ORDER";
  const isDp = input.paymentType === "DP";
  const isShipping = input.fulfilmentMethod === "SHIPPING";

  const stepDefs: { key: string; label: string; rank: number }[] = [
    { key: "ORDER_PLACED", label: "Order placed", rank: 0 },
    { key: "PAYMENT_VERIFIED", label: isDp ? "Deposit verified" : "Payment verified", rank: 1 },
  ];
  if (isPreOrder) {
    stepDefs.push({ key: "STOCK_RECEIVED", label: "Stock received", rank: 2 });
  }
  if (isDp) {
    stepDefs.push({ key: "BALANCE_PAID", label: "Balance paid", rank: 3 });
  }
  stepDefs.push({ key: "READY", label: isShipping ? "Packed, ready to ship" : "Ready for pickup", rank: 4 });
  stepDefs.push({ key: "FULFILLED", label: isShipping ? "Shipped" : "Picked up", rank: 6 });

  const doneRank = STATUS_DONE_RANK[input.status] ?? 0;
  let currentAssigned = false;

  const steps: TimelineStep[] = stepDefs.map((def) => {
    if (def.rank <= doneRank) return { key: def.key, label: def.label, state: "done" };
    if (!currentAssigned) {
      currentAssigned = true;
      return { key: def.key, label: def.label, state: "current" };
    }
    return { key: def.key, label: def.label, state: "upcoming" };
  });

  return { steps, terminalNote: null };
}
