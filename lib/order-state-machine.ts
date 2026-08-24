/**
 * Order state machine — PRD §9 (Order State Machine), §6 (End-to-End Business Flow),
 * §26 (Edge Cases & Business Rules).
 *
 * All order status changes must go through `transition()`. Nothing else in the
 * codebase should set order.status directly — that's how §3 principle 5
 * ("backend is the source of truth") and §20 (audit everything) stay true.
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

export type OrderEvent =
  | "PAYMENT_VERIFIED"
  | "RESERVATION_ALLOCATED"
  | "STOCK_STATUS_EVALUATED"
  | "STOCK_RECEIVED"
  | "BALANCE_PAYMENT_VERIFIED"
  | "PREPARE_FOR_FULFILMENT"
  | "PICKUP_CONFIRMED"
  | "TRACKING_RECORDED"
  | "MARK_COMPLETED"
  | "CANCEL"
  | "MARK_REFUND_REQUIRED"
  | "REFUND_PROCESSED";

/**
 * Facts the state machine needs to decide *which* next state applies.
 * These come from the order record itself — the state machine doesn't
 * look anything up, it's pure decision logic.
 */
export interface OrderContext {
  paymentType: "DP" | "FULL";
  /** True once on-hand inventory covers this order's reserved quantity. */
  stockAvailable: boolean;
  fulfilmentMethod: "PICKUP" | "SHIPPING" | null;
}

export class OrderTransitionError extends Error {
  constructor(
    public readonly from: OrderStatus,
    public readonly event: OrderEvent,
    message: string
  ) {
    super(`Cannot apply ${event} to order in ${from}: ${message}`);
    this.name = "OrderTransitionError";
  }
}

// §26: customer cancellation is permitted any time before SHIPPED (shipping)
// or PICKED_UP (pickup). Once in one of those, or beyond, cancellation is closed.
const CANCELLABLE_STATES = new Set<OrderStatus>([
  "PAYMENT_PENDING",
  "PAYMENT_VERIFIED",
  "RESERVED",
  "AWAITING_STOCK",
  "BALANCE_DUE",
  "READY_FOR_FULFILMENT",
  "READY_FOR_PICKUP",
  "READY_TO_SHIP",
]);

export function transition(
  current: OrderStatus,
  event: OrderEvent,
  ctx: OrderContext
): OrderStatus {
  // Cancellation is a cross-cutting rule (§26), not per-state, so it's
  // checked once here rather than repeated in every branch below.
  if (event === "CANCEL") {
    if (!CANCELLABLE_STATES.has(current)) {
      throw new OrderTransitionError(
        current,
        event,
        "order has already shipped, been picked up, or reached a terminal state"
      );
    }
    return "CANCELLED";
  }

  switch (current) {
    case "PAYMENT_PENDING":
      if (event === "PAYMENT_VERIFIED") return "PAYMENT_VERIFIED";
      break;

    case "PAYMENT_VERIFIED":
      if (event === "RESERVATION_ALLOCATED") return "RESERVED";
      break;

    case "RESERVED":
      // §11.2: pre-order commitments are tracked even before stock exists.
      // §9 (v1.2): stock readiness always resolves before balance is requested.
      if (event === "STOCK_STATUS_EVALUATED") {
        if (!ctx.stockAvailable) return "AWAITING_STOCK";
        return ctx.paymentType === "DP" ? "BALANCE_DUE" : "READY_FOR_FULFILMENT";
      }
      break;

    case "AWAITING_STOCK":
      // §9 (v1.2 resolution): AWAITING_STOCK and BALANCE_DUE are never
      // simultaneous — stock arriving resolves straight to whichever is next.
      if (event === "STOCK_RECEIVED") {
        return ctx.paymentType === "DP" ? "BALANCE_DUE" : "READY_FOR_FULFILMENT";
      }
      break;

    case "BALANCE_DUE":
      if (event === "BALANCE_PAYMENT_VERIFIED") return "READY_FOR_FULFILMENT";
      break;

    case "READY_FOR_FULFILMENT":
      if (event === "PREPARE_FOR_FULFILMENT") {
        if (ctx.fulfilmentMethod === "PICKUP") return "READY_FOR_PICKUP";
        if (ctx.fulfilmentMethod === "SHIPPING") return "READY_TO_SHIP";
        throw new OrderTransitionError(
          current,
          event,
          "fulfilmentMethod must be set before preparing for fulfilment"
        );
      }
      break;

    case "READY_FOR_PICKUP":
      if (event === "PICKUP_CONFIRMED") return "PICKED_UP";
      break;

    case "READY_TO_SHIP":
      if (event === "TRACKING_RECORDED") return "SHIPPED";
      break;

    case "PICKED_UP":
    case "SHIPPED":
      if (event === "MARK_COMPLETED") return "COMPLETED";
      break;

    case "CANCELLED":
      if (event === "MARK_REFUND_REQUIRED") return "REFUND_REQUIRED";
      break;

    case "REFUND_REQUIRED":
      // Assumption — PRD defines entry into REFUND_REQUIRED (§20) but not
      // exit. Modeled here as resolving to COMPLETED once admin processes
      // the refund manually. Confirm this is the intended end state.
      if (event === "REFUND_PROCESSED") return "COMPLETED";
      break;

    case "COMPLETED":
      break; // terminal — no events accepted
  }

  throw new OrderTransitionError(current, event, "not a valid transition from this state");
}
