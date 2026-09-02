import { describe, it, expect } from "vitest";
import { orderTotal, orderBalanceDue } from "./order-money";

// Money on an order has two parts: merchandise and shipping. Shipping is
// charged in full with the FIRST payment, so a deposit order's remaining
// balance is the rest of the merchandise — not the rest of the total.
//
// These tests exist because submit-balance-payment computed the balance from
// merchandiseSubtotal alone, understating it by exactly the shipping cost on
// every deposit + shipping order while the customer's tracker showed the
// correct figure. The two must agree by construction, so both now call this.

describe("orderTotal", () => {
  it("adds shipping to the merchandise subtotal", () => {
    expect(orderTotal({ merchandiseSubtotal: "200000.00", shippingCost: "30000.00" })).toBe(230000);
  });

  it("treats a null shipping cost as zero (pickup orders)", () => {
    expect(orderTotal({ merchandiseSubtotal: "200000.00", shippingCost: null })).toBe(200000);
  });
});

describe("orderBalanceDue", () => {
  it("is zero once a full-payment pickup order is paid", () => {
    expect(
      orderBalanceDue({ merchandiseSubtotal: "200000.00", shippingCost: null, amountPaid: "200000.00" })
    ).toBe(0);
  });

  it("is zero once a full-payment shipping order is paid", () => {
    expect(
      orderBalanceDue({ merchandiseSubtotal: "200000.00", shippingCost: "30000.00", amountPaid: "230000.00" })
    ).toBe(0);
  });

  it("is the remaining merchandise half on a deposit pickup order", () => {
    // Deposit charged at checkout = 50% of 200,000.
    expect(
      orderBalanceDue({ merchandiseSubtotal: "200000.00", shippingCost: null, amountPaid: "100000.00" })
    ).toBe(100000);
  });

  it("is the remaining merchandise half on a deposit SHIPPING order", () => {
    // THE REGRESSION GUARD. Deposit charged at checkout = 50% of 200,000 PLUS
    // all 30,000 of shipping = 130,000. The balance is the other 100,000 of
    // merchandise — shipping is already fully paid. Computing this as
    // merchandiseSubtotal - amountPaid gives 70,000, short by the shipping cost.
    expect(
      orderBalanceDue({ merchandiseSubtotal: "200000.00", shippingCost: "30000.00", amountPaid: "130000.00" })
    ).toBe(100000);
  });

  it("never goes negative when shipping exceeds half the merchandise", () => {
    // subtotal 100,000 + shipping 60,000; deposit paid = 50,000 + 60,000.
    // The broken formula yields 100,000 - 110,000 = -10,000 and would insert a
    // negative payment row.
    expect(
      orderBalanceDue({ merchandiseSubtotal: "100000.00", shippingCost: "60000.00", amountPaid: "110000.00" })
    ).toBe(50000);
  });

  it("is the whole total before anything is paid", () => {
    expect(
      orderBalanceDue({ merchandiseSubtotal: "200000.00", shippingCost: "30000.00", amountPaid: "0" })
    ).toBe(230000);
  });
});
