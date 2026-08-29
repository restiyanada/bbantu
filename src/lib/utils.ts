import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export { formatOrderNumber } from "../../lib/order-number";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatIDR(value: string | number): string {
  return `Rp ${Number(value).toLocaleString("id-ID")}`;
}

type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "warning" | "info" | "success";

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
