import { describe, it, expect } from "vitest";
import {
  transition,
  OrderTransitionError,
  type OrderContext,
  type OrderStatus,
} from "./order-state-machine";

describe("order state machine — PRD §32 acceptance scenarios", () => {
  it("Scenario A: full-payment pre-order → awaits stock → pickup → completed", () => {
    const ctx: OrderContext = {
      paymentType: "FULL",
      stockAvailable: false,
      fulfilmentMethod: "PICKUP",
    };
    let s: OrderStatus = "PAYMENT_PENDING";

    s = transition(s, "PAYMENT_VERIFIED", ctx);
    expect(s).toBe("PAYMENT_VERIFIED");

    s = transition(s, "RESERVATION_ALLOCATED", ctx);
    expect(s).toBe("RESERVED");

    s = transition(s, "STOCK_STATUS_EVALUATED", ctx);
    expect(s).toBe("AWAITING_STOCK");

    ctx.stockAvailable = true;
    s = transition(s, "STOCK_RECEIVED", ctx);
    expect(s).toBe("READY_FOR_FULFILMENT");

    s = transition(s, "PREPARE_FOR_FULFILMENT", ctx);
    expect(s).toBe("READY_FOR_PICKUP");

    s = transition(s, "PICKUP_CONFIRMED", ctx);
    expect(s).toBe("PICKED_UP");

    s = transition(s, "MARK_COMPLETED", ctx);
    expect(s).toBe("COMPLETED");
  });

  it("Scenario B: DP pre-order → balance due after stock arrives → shipping → completed", () => {
    const ctx: OrderContext = {
      paymentType: "DP",
      stockAvailable: false,
      fulfilmentMethod: "SHIPPING",
    };
    let s: OrderStatus = "PAYMENT_PENDING";

    s = transition(s, "PAYMENT_VERIFIED", ctx);
    s = transition(s, "RESERVATION_ALLOCATED", ctx);

    s = transition(s, "STOCK_STATUS_EVALUATED", ctx);
    expect(s).toBe("AWAITING_STOCK");

    ctx.stockAvailable = true;
    s = transition(s, "STOCK_RECEIVED", ctx);
    expect(s).toBe("BALANCE_DUE");

    s = transition(s, "BALANCE_PAYMENT_VERIFIED", ctx);
    expect(s).toBe("READY_FOR_FULFILMENT");

    s = transition(s, "PREPARE_FOR_FULFILMENT", ctx);
    expect(s).toBe("READY_TO_SHIP");

    s = transition(s, "TRACKING_RECORDED", ctx);
    expect(s).toBe("SHIPPED");

    s = transition(s, "MARK_COMPLETED", ctx);
    expect(s).toBe("COMPLETED");
  });
});

describe("order state machine — ready stock (stock already on hand)", () => {
  it("skips AWAITING_STOCK entirely and goes straight to BALANCE_DUE for a DP order", () => {
    const ctx: OrderContext = {
      paymentType: "DP",
      stockAvailable: true,
      fulfilmentMethod: "PICKUP",
    };
    let s: OrderStatus = "PAYMENT_PENDING";

    s = transition(s, "PAYMENT_VERIFIED", ctx);
    s = transition(s, "RESERVATION_ALLOCATED", ctx);
    s = transition(s, "STOCK_STATUS_EVALUATED", ctx);

    expect(s).toBe("BALANCE_DUE");
  });

  it("skips AWAITING_STOCK and goes straight to READY_FOR_FULFILMENT for a FULL order", () => {
    const ctx: OrderContext = {
      paymentType: "FULL",
      stockAvailable: true,
      fulfilmentMethod: "PICKUP",
    };
    let s: OrderStatus = "PAYMENT_PENDING";

    s = transition(s, "PAYMENT_VERIFIED", ctx);
    s = transition(s, "RESERVATION_ALLOCATED", ctx);
    s = transition(s, "STOCK_STATUS_EVALUATED", ctx);

    expect(s).toBe("READY_FOR_FULFILMENT");
  });
});

describe("order state machine — cancellation (§26)", () => {
  const ctx: OrderContext = {
    paymentType: "FULL",
    stockAvailable: true,
    fulfilmentMethod: "SHIPPING",
  };

  it.each<OrderStatus>([
    "PAYMENT_PENDING",
    "PAYMENT_VERIFIED",
    "RESERVED",
    "AWAITING_STOCK",
    "BALANCE_DUE",
    "READY_FOR_FULFILMENT",
    "READY_FOR_PICKUP",
    "READY_TO_SHIP",
  ])("allows cancellation from %s", (status) => {
    expect(transition(status, "CANCEL", ctx)).toBe("CANCELLED");
  });

  it.each<OrderStatus>(["SHIPPED", "PICKED_UP", "COMPLETED"])(
    "blocks cancellation once the order reaches %s",
    (status) => {
      expect(() => transition(status, "CANCEL", ctx)).toThrow(OrderTransitionError);
    }
  );
});

describe("order state machine — invalid transitions", () => {
  it("throws when trying to skip states", () => {
    const ctx: OrderContext = {
      paymentType: "FULL",
      stockAvailable: true,
      fulfilmentMethod: "PICKUP",
    };
    expect(() => transition("PAYMENT_PENDING", "PICKUP_CONFIRMED", ctx)).toThrow(
      OrderTransitionError
    );
  });

  it("throws when preparing for fulfilment without a fulfilment method set", () => {
    const ctx: OrderContext = {
      paymentType: "FULL",
      stockAvailable: true,
      fulfilmentMethod: null,
    };
    expect(() =>
      transition("READY_FOR_FULFILMENT", "PREPARE_FOR_FULFILMENT", ctx)
    ).toThrow(OrderTransitionError);
  });

  it("COMPLETED is terminal — no further events accepted", () => {
    const ctx: OrderContext = {
      paymentType: "FULL",
      stockAvailable: true,
      fulfilmentMethod: "PICKUP",
    };
    expect(() => transition("COMPLETED", "MARK_COMPLETED", ctx)).toThrow(
      OrderTransitionError
    );
  });
});
