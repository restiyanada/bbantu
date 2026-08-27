import { describe, it, expect } from "vitest";
import { allocateReceivedStock, type WaitingOrder, type VariantStock } from "./batch-allocation";

const HOODIE = "variant-hoodie";
const TOTE = "variant-tote";

function order(id: string, reservedAt: string, items: WaitingOrder["items"]): WaitingOrder {
  return { orderId: id, reservedAt: new Date(reservedAt), items };
}

describe("allocateReceivedStock — PRD §26 MOQ shortfall rule", () => {
  it("promotes a single order when enough stock arrived", () => {
    const stock = new Map<string, VariantStock>([[HOODIE, { onHand: 5, reserved: 0 }]]);
    const waiting = [order("o1", "2026-01-01T00:00:00Z", [{ variantId: HOODIE, quantity: 3 }])];

    const result = allocateReceivedStock(waiting, stock);

    expect(result.promoted.map((o) => o.orderId)).toEqual(["o1"]);
    expect(result.stillWaiting).toHaveLength(0);
    expect(result.reservedDeltaByVariant.get(HOODIE)).toBe(3);
  });

  it("promotes exactly at the boundary (order qty === available)", () => {
    const stock = new Map<string, VariantStock>([[HOODIE, { onHand: 3, reserved: 0 }]]);
    const waiting = [order("o1", "2026-01-01T00:00:00Z", [{ variantId: HOODIE, quantity: 3 }])];

    const result = allocateReceivedStock(waiting, stock);

    expect(result.promoted.map((o) => o.orderId)).toEqual(["o1"]);
  });

  it("shortfall: promotes the earliest-verified orders first, leaves the rest waiting", () => {
    // 10 arrived. o2 verified first (qty 6), o1 verified second (qty 6) —
    // only one of them fits. Verification order must win, not array order.
    const stock = new Map<string, VariantStock>([[HOODIE, { onHand: 10, reserved: 0 }]]);
    const waiting = [
      order("o1", "2026-01-02T00:00:00Z", [{ variantId: HOODIE, quantity: 6 }]),
      order("o2", "2026-01-01T00:00:00Z", [{ variantId: HOODIE, quantity: 6 }]),
    ];

    const result = allocateReceivedStock(waiting, stock);

    expect(result.promoted.map((o) => o.orderId)).toEqual(["o2"]);
    expect(result.stillWaiting.map((o) => o.orderId)).toEqual(["o1"]);
    expect(result.reservedDeltaByVariant.get(HOODIE)).toBe(6);
  });

  it("a later order can jump ahead of an earlier one still missing a different item (no partial promotion)", () => {
    const stock = new Map<string, VariantStock>([
      [HOODIE, { onHand: 5, reserved: 0 }],
      [TOTE, { onHand: 0, reserved: 0 }], // tote hasn't arrived yet
    ]);
    const waiting = [
      // Verified first, but needs a tote too — must NOT be partially
      // promoted just because its hoodie is available.
      order("mixed-order", "2026-01-01T00:00:00Z", [
        { variantId: HOODIE, quantity: 2 },
        { variantId: TOTE, quantity: 1 },
      ]),
      // Verified later, only needs a hoodie — should still go through.
      order("hoodie-only", "2026-01-02T00:00:00Z", [{ variantId: HOODIE, quantity: 2 }]),
    ];

    const result = allocateReceivedStock(waiting, stock);

    expect(result.promoted.map((o) => o.orderId)).toEqual(["hoodie-only"]);
    expect(result.stillWaiting.map((o) => o.orderId)).toEqual(["mixed-order"]);
    // The stuck order's hoodie stake was never consumed.
    expect(result.reservedDeltaByVariant.get(HOODIE)).toBe(2);
    expect(result.reservedDeltaByVariant.get(TOTE)).toBeUndefined();
  });

  it("is repeatable: a later receipt can promote an order stuck on a previous run", () => {
    // First run: tote hasn't arrived, mixed-order stays waiting (as above).
    const afterFirstReceipt = new Map<string, VariantStock>([
      [HOODIE, { onHand: 5, reserved: 2 }], // hoodie-only's 2 units already reserved
      [TOTE, { onHand: 0, reserved: 0 }],
    ]);
    const stillWaitingFromBefore = [
      order("mixed-order", "2026-01-01T00:00:00Z", [
        { variantId: HOODIE, quantity: 2 },
        { variantId: TOTE, quantity: 1 },
      ]),
    ];

    // Second run: the tote shipment arrives.
    const afterSecondReceipt = new Map<string, VariantStock>([
      [HOODIE, { onHand: 5, reserved: 2 }],
      [TOTE, { onHand: 1, reserved: 0 }],
    ]);

    const firstResult = allocateReceivedStock(stillWaitingFromBefore, afterFirstReceipt);
    expect(firstResult.promoted).toHaveLength(0);

    const secondResult = allocateReceivedStock(firstResult.stillWaiting, afterSecondReceipt);
    expect(secondResult.promoted.map((o) => o.orderId)).toEqual(["mixed-order"]);
  });

  it("returns nothing to do for an empty waiting list", () => {
    const result = allocateReceivedStock([], new Map());
    expect(result.promoted).toHaveLength(0);
    expect(result.stillWaiting).toHaveLength(0);
    expect(result.reservedDeltaByVariant.size).toBe(0);
  });

  it("an order with no stock at all for its item stays waiting, not promoted with a negative reservation", () => {
    const stock = new Map<string, VariantStock>([[HOODIE, { onHand: 0, reserved: 0 }]]);
    const waiting = [order("o1", "2026-01-01T00:00:00Z", [{ variantId: HOODIE, quantity: 1 }])];

    const result = allocateReceivedStock(waiting, stock);

    expect(result.promoted).toHaveLength(0);
    expect(result.stillWaiting.map((o) => o.orderId)).toEqual(["o1"]);
  });
});
