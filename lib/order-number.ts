/**
 * "#010007" style — 01/02 encodes fulfilment method, last 4 digits are the
 * sequence within that type (db/schema.ts pickup_order_seq/shipping_order_seq).
 * Falls back to a short id slice if orderNumber isn't set yet (fulfilment
 * method not chosen — §7.2 "configured later").
 *
 * Shared between the frontend (order page) and the email worker (subject
 * lines, §17.2 "subject line contains order ID") — moved here (Milestone 5)
 * rather than duplicated, so both always show the exact same format.
 */
export function formatOrderNumber(
  fulfilmentMethod: string | null,
  orderNumber: number | null,
  fallbackId: string
): string {
  if (orderNumber == null || !fulfilmentMethod) {
    return fallbackId.slice(0, 8);
  }
  const typeCode = fulfilmentMethod === "SHIPPING" ? "02" : "01";
  return `#${typeCode}${String(orderNumber).padStart(4, "0")}`;
}
