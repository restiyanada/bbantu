import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Milestone 5: moved to the shared lib/ folder so the email worker (Deno)
// can use the exact same format — re-exported here so every existing
// `import { formatOrderNumber } from "@/lib/utils"` in this codebase keeps
// working unchanged.
export { formatOrderNumber } from "../../lib/order-number";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatIDR(value: string | number): string {
  return `Rp ${Number(value).toLocaleString("id-ID")}`;
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
