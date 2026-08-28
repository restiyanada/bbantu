/**
 * Per-IP rate limiting — PRD §16.1/§27 ("maximum 10 requests per minute per
 * IP"), applied to supabase/functions/recover-order-access (Milestone 6).
 *
 * Pure decision logic, no DB access — same "what should happen" vs. "how
 * it's written to the DB" split as lib/batch-allocation.ts and
 * lib/order-state-machine.ts. The caller counts rows in
 * access_recovery_attempts within the window and passes that count in.
 */

export const RATE_LIMIT_WINDOW_MS = 60_000; // §16.1: "per minute"
export const RATE_LIMIT_MAX_REQUESTS = 10; // §16.1: "maximum 10 requests"

/**
 * True when the caller has already made `RATE_LIMIT_MAX_REQUESTS` (or more)
 * requests within the current window and the new request should be
 * rejected. `attemptsInWindow` is the count of *prior* attempts only (the
 * request being evaluated is not yet counted) — the 11th attempt within a
 * minute is the first one blocked, not the 10th.
 */
export function isRateLimited(attemptsInWindow: number, max: number = RATE_LIMIT_MAX_REQUESTS): boolean {
  return attemptsInWindow >= max;
}

/** Start of the current rate-limit window, relative to `now`. */
export function windowStart(now: Date, windowMs: number = RATE_LIMIT_WINDOW_MS): Date {
  return new Date(now.getTime() - windowMs);
}
