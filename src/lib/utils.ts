import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export { formatOrderNumber } from "../../lib/order-number";
export { orderTotal, orderBalanceDue } from "../../lib/order-money";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * `supabase.functions.invoke` swallows the Edge Function's actual response
 * body into an opaque error object. The real reason — "you don't have this
 * permission", "no pending payment to verify", a 500 — lives in
 * `error.context`, a Response the caller has to read explicitly. Falling back
 * to a canned message on every failure is why a permission or state error and
 * a genuine outage looked identical in the admin UI.
 */
export async function functionErrorMessage(error: unknown, fallback: string): Promise<string> {
  const context = (error as { context?: Response } | null)?.context;
  if (!(context instanceof Response)) return fallback;
  try {
    const body = await context.clone().json();
    return typeof body?.error === "string" ? body.error : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Storage object keys embed the original filename (`{token}/{uuid}-{name}`).
 * Supabase Storage keys aren't a filesystem path — `../` in a key is just an
 * odd-looking key, not traversal — but there's no reason to depend on that
 * rather than just not passing through separators and control characters.
 */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned.length > 0 ? cleaned : "file";
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
