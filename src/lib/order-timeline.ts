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
  terminalNote: { label: string; tone: "cancelled" | "refund" } | null;
}

const STATUS_DONE_RANK: Record<OrderStatus, number> = {
  PAYMENT_PENDING: 0,
  PAYMENT_VERIFIED: 1,
  RESERVED: 1,
  AWAITING_STOCK: 1,
  BALANCE_DUE: 2,
  READY_FOR_FULFILMENT: 3,
  READY_FOR_PICKUP: 4,
  READY_TO_SHIP: 4,
  PICKED_UP: 6,
  SHIPPED: 6,
  COMPLETED: 6,
  CANCELLED: 0,
  REFUND_REQUIRED: 0,
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
