import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { releaseReservation, type ReservationTransaction } from "./reservation";
import { inventory } from "../db/schema";
import type { orderItems } from "../db/schema";

type OrderItemRow = typeof orderItems.$inferSelect;

function makeFakeTx(items: OrderItemRow[]) {
  const calls: { updates: Array<{ table: unknown; values: unknown; where: unknown }>; inserts: unknown[] } = {
    updates: [],
    inserts: [],
  };

  const tx: ReservationTransaction = {
    select: () => ({
      from: () => ({
        where: async () => items,
      }),
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: async (where: unknown) => {
          calls.updates.push({ table, values, where });
        },
      }),
    }),
    insert: () => ({
      values: async (row: unknown) => {
        calls.inserts.push(row);
      },
    }),
  };

  return { tx, calls };
}

function item(overrides: Partial<OrderItemRow> = {}): OrderItemRow {
  return {
    id: "item-1",
    orderId: "order-1",
    variantId: "variant-1",
    quantity: 2,
    unitPrice: "50.00",
    productName: "Hoodie",
    variantName: "M",
    imageUrls: null,
    ...overrides,
  };
}

describe("releaseReservation", () => {
  it("decrements inventory.reserved by the line quantity for each of an order's items", async () => {
    const items = [
      item({ id: "item-1", variantId: "variant-1", quantity: 2 }),
      item({ id: "item-2", variantId: "variant-2", quantity: 5 }),
    ];
    const { tx, calls } = makeFakeTx(items);

    await releaseReservation(tx, { orderId: "order-1", actorId: "admin-1", reason: "Order cancelled" });

    expect(calls.updates).toHaveLength(2);
    expect(calls.updates[0].values).toEqual({ reserved: sql`${inventory.reserved} - ${2}` });
    expect(calls.updates[1].values).toEqual({ reserved: sql`${inventory.reserved} - ${5}` });
  });

  it("writes one inventory_transactions row per variant, with a positive quantityDelta and the supplied reason", async () => {
    const items = [
      item({ id: "item-1", variantId: "variant-1", quantity: 2 }),
      item({ id: "item-2", variantId: "variant-2", quantity: 5 }),
    ];
    const { tx, calls } = makeFakeTx(items);

    await releaseReservation(tx, { orderId: "order-1", actorId: "admin-1", reason: "Order cancelled" });

    expect(calls.inserts).toHaveLength(2);
    expect(calls.inserts[0]).toEqual({
      variantId: "variant-1",
      quantityDelta: 2,
      reason: "Order cancelled",
      createdBy: "admin-1",
    });
    expect(calls.inserts[1]).toEqual({
      variantId: "variant-2",
      quantityDelta: 5,
      reason: "Order cancelled",
      createdBy: "admin-1",
    });
  });

  it("records a positive quantityDelta — the opposite sign to verify-payment's negative allocation entry", async () => {
    const items = [item({ variantId: "variant-1", quantity: 3 })];
    const { tx, calls } = makeFakeTx(items);

    await releaseReservation(tx, { orderId: "order-1", actorId: null, reason: "Order cancelled" });

    const inserted = calls.inserts[0] as { quantityDelta: number };
    expect(inserted.quantityDelta).toBe(3);
    expect(inserted.quantityDelta).toBeGreaterThan(0);
  });

  it("returns the per-variant quantities released", async () => {
    const items = [
      item({ variantId: "variant-1", quantity: 2 }),
      item({ variantId: "variant-2", quantity: 5 }),
    ];
    const { tx } = makeFakeTx(items);

    const result = await releaseReservation(tx, { orderId: "order-1", actorId: "admin-1", reason: "Order cancelled" });

    expect(result).toEqual([
      { variantId: "variant-1", quantity: 2 },
      { variantId: "variant-2", quantity: 5 },
    ]);
  });

  it("releases nothing and writes no ledger rows for an order with no items", async () => {
    const { tx, calls } = makeFakeTx([]);

    const result = await releaseReservation(tx, { orderId: "order-empty", actorId: "admin-1", reason: "Order cancelled" });

    expect(result).toEqual([]);
    expect(calls.updates).toHaveLength(0);
    expect(calls.inserts).toHaveLength(0);
  });
});
