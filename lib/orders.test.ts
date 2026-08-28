import { describe, it, expect, vi } from "vitest";
import { transitionOrder, OrderNotFoundError, type OrdersTransaction } from "./orders";
import { OrderTransitionError } from "./order-state-machine";
import type { orders } from "../db/schema";

type OrderRow = typeof orders.$inferSelect;

/**
 * A fake transaction implementing just enough of the drizzle query-builder
 * shape for transitionOrder to run against, with every write recorded so
 * tests can assert on write order and (critically) on writes that must
 * NOT happen when a transition is rejected.
 */
function makeFakeTx(existingOrder: OrderRow | undefined) {
  const calls: { updates: unknown[]; inserts: unknown[] } = { updates: [], inserts: [] };

  const tx: OrdersTransaction = {
    select: () => ({
      from: () => ({
        where: () => ({
          for: async () => (existingOrder ? [existingOrder] : []),
        }),
      }),
    }),
    update: () => ({
      set: (values: unknown) => ({
        where: async () => {
          calls.updates.push(values);
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

function baseOrder(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: "order-1",
    customerId: "customer-1",
    salesMode: "READY_STOCK",
    batchId: null,
    status: "PAYMENT_PENDING",
    paymentType: "FULL",
    fulfilmentMethod: "PICKUP",
    orderNumber: 1,
    reservedAt: null,
    merchandiseSubtotal: "100.00",
    shippingCost: null,
    amountPaid: "0",
    submissionToken: "tok-1",
    accessToken: "acc-1",
    accessTokenEncrypted: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("transitionOrder", () => {
  it("reads the order, writes the new status, and logs an audit row", async () => {
    const { tx, calls } = makeFakeTx(baseOrder());

    const result = await transitionOrder(tx, {
      orderId: "order-1",
      event: "PAYMENT_VERIFIED",
      actorId: "admin-1",
      stockAvailable: true,
    });

    expect(result).toEqual({ from: "PAYMENT_PENDING", to: "PAYMENT_VERIFIED" });
    expect(calls.updates).toEqual([{ status: "PAYMENT_VERIFIED" }]);
    expect(calls.inserts).toHaveLength(1);
    expect(calls.inserts[0]).toMatchObject({
      actorId: "admin-1",
      entityType: "order",
      entityId: "order-1",
      action: "PAYMENT_VERIFIED: PAYMENT_PENDING -> PAYMENT_VERIFIED",
      beforeValue: { status: "PAYMENT_PENDING" },
      afterValue: { status: "PAYMENT_VERIFIED" },
    });
  });

  it("throws OrderNotFoundError and performs no writes when the order doesn't exist", async () => {
    const { tx, calls } = makeFakeTx(undefined);

    await expect(
      transitionOrder(tx, {
        orderId: "missing-order",
        event: "PAYMENT_VERIFIED",
        actorId: "admin-1",
        stockAvailable: true,
      })
    ).rejects.toThrow(OrderNotFoundError);

    expect(calls.updates).toHaveLength(0);
    expect(calls.inserts).toHaveLength(0);
  });

  it("propagates OrderTransitionError and performs no writes on an invalid transition", async () => {
    const { tx, calls } = makeFakeTx(baseOrder({ status: "PAYMENT_PENDING" }));

    await expect(
      transitionOrder(tx, {
        orderId: "order-1",
        event: "PICKUP_CONFIRMED", // not valid from PAYMENT_PENDING
        actorId: "admin-1",
        stockAvailable: true,
      })
    ).rejects.toThrow(OrderTransitionError);

    expect(calls.updates).toHaveLength(0);
    expect(calls.inserts).toHaveLength(0);
  });

  it("builds context from the order row, not from caller-supplied paymentType/fulfilmentMethod", async () => {
    const { tx, calls } = makeFakeTx(
      baseOrder({ status: "RESERVED", paymentType: "DP", fulfilmentMethod: "SHIPPING" })
    );

    const result = await transitionOrder(tx, {
      orderId: "order-1",
      event: "STOCK_STATUS_EVALUATED",
      actorId: null,
      stockAvailable: true, // stock already on hand -> DP order should land on BALANCE_DUE
    });

    expect(result.to).toBe("BALANCE_DUE");
    expect(calls.updates).toEqual([{ status: "BALANCE_DUE" }]);
  });

  it("locks the row with SELECT ... FOR UPDATE", async () => {
    const forSpy = vi.fn(async () => [baseOrder()]);
    const tx: OrdersTransaction = {
      select: () => ({ from: () => ({ where: () => ({ for: forSpy }) }) }),
      update: () => ({ set: () => ({ where: async () => {} }) }),
      insert: () => ({ values: async () => {} }),
    };

    await transitionOrder(tx, {
      orderId: "order-1",
      event: "PAYMENT_VERIFIED",
      actorId: null,
      stockAvailable: true,
    });

    expect(forSpy).toHaveBeenCalledWith("update");
  });
});
