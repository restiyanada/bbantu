import { corsHeaders } from "./cors.ts";
import { OrderTransitionError } from "../../../lib/order-state-machine.ts";
import { OrderNotFoundError } from "../../../lib/orders.ts";

/** Thrown inside a handler to short-circuit with a specific HTTP status + message. */
export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Maps a caught error to an HTTP response. Centralized so every handler's
 * catch block treats "invalid state transition" and "order not found" as the
 * client/business errors they are (409/404), not unexpected server errors —
 * duplicating this per-function was already a real bug in an earlier draft
 * of verify-payment, not hypothetical.
 */
export function errorResponse(err: unknown, unexpectedMessage: string): Response {
  if (err instanceof HttpError) return json({ error: err.message }, err.status);
  if (err instanceof OrderTransitionError) return json({ error: err.message }, 409);
  if (err instanceof OrderNotFoundError) return json({ error: err.message }, 404);
  console.error(unexpectedMessage, err);
  return json({ error: unexpectedMessage }, 500);
}

/** Postgres SQLSTATE 23505 = unique_violation. postgres.js attaches `.code` to thrown errors. */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "23505";
}

/**
 * Money as integer cents to avoid floating-point drift when summing line
 * items — `numeric` columns come back from drizzle/postgres.js as strings
 * specifically to avoid this, so we convert deliberately at the boundary
 * rather than doing arithmetic on floats directly.
 */
export function decimalStringToCents(value: string): number {
  return Math.round(Number(value) * 100);
}

export function centsToDecimalString(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Client IP for per-IP rate limiting (Milestone 6, §16.1/§27) — Supabase
 * Edge Functions run behind a proxy, so the real client address is in
 * x-forwarded-for (the first entry; later entries are intermediate
 * proxies), not available from the connection itself. Falls back to a
 * fixed string rather than throwing: an Edge Function without this header
 * (e.g. a local `supabase functions serve` test) shouldn't crash the
 * request, it should just rate-limit as one shared bucket.
 */
export function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return "unknown";
}
