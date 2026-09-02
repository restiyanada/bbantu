/**
 * The money arithmetic for an order, in one place.
 *
 * An order's total is merchandise plus shipping. Shipping is charged in full
 * with the FIRST payment (see create-order), so on a deposit order the
 * remaining balance is the rest of the merchandise, not the rest of the total.
 *
 * This module exists because that arithmetic was written twice and the two
 * copies disagreed: the customer's tracker computed the balance from the whole
 * total while submit-balance-payment computed it from the merchandise subtotal
 * alone. Every deposit + shipping order was therefore recorded as paying the
 * shipping cost less than the customer actually transferred. Both callers now
 * share this, so they cannot drift again.
 *
 * Values are decimal strings straight out of Postgres `numeric(12, 2)` and come
 * back as whole rupiah.
 */

export interface OrderAmounts {
  merchandiseSubtotal: string;
  shippingCost: string | null;
}

export interface PaidOrderAmounts extends OrderAmounts {
  amountPaid: string;
}

/** Merchandise plus shipping. A null shipping cost means pickup. */
export function orderTotal(order: OrderAmounts): number {
  return Number(order.merchandiseSubtotal) + Number(order.shippingCost ?? 0);
}

/** What the customer still owes. Never negative. */
export function orderBalanceDue(order: PaidOrderAmounts): number {
  return Math.max(0, orderTotal(order) - Number(order.amountPaid));
}
