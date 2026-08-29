import { corsHeaders } from "./cors.ts";
import { OrderTransitionError } from "../../../lib/order-state-machine.ts";
import { OrderNotFoundError } from "../../../lib/orders.ts";

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

export function errorResponse(err: unknown, unexpectedMessage: string): Response {
  if (err instanceof HttpError) return json({ error: err.message }, err.status);
  if (err instanceof OrderTransitionError) return json({ error: err.message }, 409);
  if (err instanceof OrderNotFoundError) return json({ error: err.message }, 404);
  console.error(unexpectedMessage, err);
  return json({ error: unexpectedMessage }, 500);
}

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "23505";
}

export function decimalStringToCents(value: string): number {
  return Math.round(Number(value) * 100);
}

export function centsToDecimalString(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return "unknown";
}
