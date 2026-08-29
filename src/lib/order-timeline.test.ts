import { describe, it, expect } from "vitest";
import { buildOrderTimeline } from "./order-timeline";

describe("order timeline (§16.3)", () => {
  it("ready stock, pickup: no stock-received or balance-paid steps", () => {
    const t = buildOrderTimeline({
      status: "PAYMENT_VERIFIED",
      salesMode: "READY_STOCK",
      paymentType: "FULL",
      fulfilmentMethod: "PICKUP",
    });
    expect(t.steps.map((s) => s.key)).toEqual(["ORDER_PLACED", "PAYMENT_VERIFIED", "READY", "FULFILLED"]);
    expect(t.steps.map((s) => s.state)).toEqual(["done", "done", "current", "upcoming"]);
    expect(t.steps.find((s) => s.key === "READY")?.label).toBe("Ready for pickup");
    expect(t.steps.find((s) => s.key === "FULFILLED")?.label).toBe("Picked up");
  });

  it("ready stock, shipping: same shape, shipping labels", () => {
    const t = buildOrderTimeline({
      status: "READY_TO_SHIP",
      salesMode: "READY_STOCK",
      paymentType: "FULL",
      fulfilmentMethod: "SHIPPING",
    });
    expect(t.steps.find((s) => s.key === "READY")?.label).toBe("Packed, ready to ship");
    expect(t.steps.find((s) => s.key === "FULFILLED")?.label).toBe("Shipped");
    expect(t.steps.find((s) => s.key === "READY")?.state).toBe("done");
    expect(t.steps.find((s) => s.key === "FULFILLED")?.state).toBe("current");
  });

  it("pre-order, full payment: has stock-received, no balance-paid", () => {
    const t = buildOrderTimeline({
      status: "AWAITING_STOCK",
      salesMode: "PRE_ORDER",
      paymentType: "FULL",
      fulfilmentMethod: "PICKUP",
    });
    expect(t.steps.map((s) => s.key)).toEqual(["ORDER_PLACED", "PAYMENT_VERIFIED", "STOCK_RECEIVED", "READY", "FULFILLED"]);
    expect(t.steps.map((s) => s.state)).toEqual(["done", "done", "current", "upcoming", "upcoming"]);
  });

  it("pre-order, deposit: has both stock-received and balance-paid, in order", () => {
    const t = buildOrderTimeline({
      status: "BALANCE_DUE",
      salesMode: "PRE_ORDER",
      paymentType: "DP",
      fulfilmentMethod: "SHIPPING",
    });
    expect(t.steps.map((s) => s.key)).toEqual([
      "ORDER_PLACED",
      "PAYMENT_VERIFIED",
      "STOCK_RECEIVED",
      "BALANCE_PAID",
      "READY",
      "FULFILLED",
    ]);
    expect(t.steps.map((s) => s.state)).toEqual(["done", "done", "done", "current", "upcoming", "upcoming"]);
    expect(t.steps.find((s) => s.key === "PAYMENT_VERIFIED")?.label).toBe("Deposit verified");
  });

  it("pre-order, deposit, resolves stock immediately without waiting: skips straight to balance-paid as current", () => {
    const t = buildOrderTimeline({
      status: "READY_FOR_FULFILMENT",
      salesMode: "PRE_ORDER",
      paymentType: "FULL",
      fulfilmentMethod: "PICKUP",
    });
    expect(t.steps.map((s) => s.state)).toEqual(["done", "done", "done", "current", "upcoming"]);
  });

  it("everything done: picked up / shipped / completed all fully check off", () => {
    for (const status of ["PICKED_UP", "SHIPPED", "COMPLETED"] as const) {
      const t = buildOrderTimeline({
        status,
        salesMode: "PRE_ORDER",
        paymentType: "DP",
        fulfilmentMethod: "PICKUP",
      });
      expect(t.steps.every((s) => s.state === "done")).toBe(true);
    }
  });

  it("cancelled: shows order placed, then a cancelled marker — not a fabricated history", () => {
    const t = buildOrderTimeline({
      status: "CANCELLED",
      salesMode: "PRE_ORDER",
      paymentType: "DP",
      fulfilmentMethod: "SHIPPING",
    });
    expect(t.steps).toEqual([{ key: "ORDER_PLACED", label: "Order placed", state: "done" }]);
    expect(t.terminalNote).toEqual({ label: "Cancelled", tone: "cancelled" });
  });

  it("refund required: same shape as cancelled, different label/tone", () => {
    const t = buildOrderTimeline({
      status: "REFUND_REQUIRED",
      salesMode: "READY_STOCK",
      paymentType: "FULL",
      fulfilmentMethod: "PICKUP",
    });
    expect(t.terminalNote).toEqual({ label: "Refund in progress", tone: "refund" });
  });
});
