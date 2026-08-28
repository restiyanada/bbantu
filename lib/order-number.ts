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

export interface ParsedOrderNumber {
  fulfilmentMethod: "PICKUP" | "SHIPPING";
  orderNumber: number;
}

/**
 * Inverse of formatOrderNumber — Milestone 6 (§16.2 order access recovery,
 * item 30). Accepts exactly what a customer would see and copy/paste back
 * (leading "#" optional, at least 4 digits after the 2-digit type code) —
 * deliberately not the fallbackId short-id-slice form above, which only
 * appears for orders that haven't had a fulfilment method chosen yet and
 * isn't a stable identifier to recover by.
 */
export function parseOrderNumber(input: string): ParsedOrderNumber | null {
  const trimmed = input.trim().replace(/^#/, "");
  const match = /^(01|02)(\d{4,})$/.exec(trimmed);
  if (!match) return null;

  return {
    fulfilmentMethod: match[1] === "02" ? "SHIPPING" : "PICKUP",
    orderNumber: Number.parseInt(match[2], 10),
  };
}
