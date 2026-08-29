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

export interface OrderContext {
  paymentType: "DP" | "FULL";
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
      if (event === "STOCK_STATUS_EVALUATED") {
        if (!ctx.stockAvailable) return "AWAITING_STOCK";
        return ctx.paymentType === "DP" ? "BALANCE_DUE" : "READY_FOR_FULFILMENT";
      }
      break;

    case "AWAITING_STOCK":
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
      if (event === "REFUND_PROCESSED") return "COMPLETED";
      break;

    case "COMPLETED":
      break;
  }

  throw new OrderTransitionError(current, event, "not a valid transition from this state");
}
