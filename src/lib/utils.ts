import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatIDR(value: string | number): string {
  return `Rp ${Number(value).toLocaleString("id-ID")}`;
}

/**
 * "#010007" style — 01/02 encodes fulfilment method, last 4 digits are the
 * sequence within that type (db/schema.ts pickup_order_seq/shipping_order_seq).
 * Falls back to a short id slice if orderNumber isn't set yet (fulfilment
 * method not chosen — §7.2 "configured later").
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

type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "warning" | "info" | "success";

/**
 * One mapping shared across every page that shows an order status badge —
 * was duplicated (3-variant version) in OrderPage.tsx and
 * AdminDashboardPage.tsx; consolidated here now that it's grown to cover
 * all 12 statuses with real color meaning (amber = waiting on someone,
 * blue = in progress, green = done, red = problem).
 */
export function statusBadgeVariant(status: string): BadgeVariant {
  switch (status) {
    case "PAYMENT_PENDING":
    case "AWAITING_STOCK":
    case "BALANCE_DUE":
      return "warning";
    case "PAYMENT_VERIFIED":
    case "RESERVED":
    case "READY_FOR_FULFILMENT":
    case "READY_FOR_PICKUP":
    case "READY_TO_SHIP":
      return "info";
    case "PICKED_UP":
    case "SHIPPED":
    case "COMPLETED":
      return "success";
    case "CANCELLED":
    case "REFUND_REQUIRED":
      return "destructive";
    default:
      return "secondary";
  }
}
