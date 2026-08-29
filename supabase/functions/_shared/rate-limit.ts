import { and, eq, gte } from "drizzle-orm";
import { db } from "./db.ts";
import { HttpError, getClientIp } from "./http.ts";
import { rateLimitAttempts } from "../../../db/schema.ts";
import { isRateLimited, windowStart, RATE_LIMIT_MAX_REQUESTS } from "../../../lib/rate-limit.ts";

/**
 * Per-IP rate limiting for guest-facing endpoints (§16.1/§19).
 *
 * Records the attempt and throws 429 once the caller is over budget inside the
 * current window. `endpoint` scopes the count, so each function has its own
 * budget rather than sharing one global bucket.
 *
 * Deliberately counts the attempt *before* doing the work, not after: the point
 * is to cap how much work an abusive caller can cause, so a request that fails
 * downstream still has to pay for its slot.
 *
 * Note on `getClientIp`: this reads the first entry of `x-forwarded-for`, which
 * a caller can spoof. It is not an identity check — it raises the cost of
 * casual abuse (scripted loops against the paid shipping API, order-number
 * guessing) without pretending to stop a determined attacker rotating headers.
 * Real defence for that is at the edge/CDN layer, not here.
 */
export async function enforceRateLimit(
  req: Request,
  endpoint: string,
  max: number = RATE_LIMIT_MAX_REQUESTS
): Promise<void> {
  const ip = getClientIp(req);
  const now = new Date();

  const priorAttempts = await db
    .select({ id: rateLimitAttempts.id })
    .from(rateLimitAttempts)
    .where(
      and(
        eq(rateLimitAttempts.endpoint, endpoint),
        eq(rateLimitAttempts.ipAddress, ip),
        gte(rateLimitAttempts.createdAt, windowStart(now))
      )
    );

  await db.insert(rateLimitAttempts).values({ endpoint, ipAddress: ip });

  if (isRateLimited(priorAttempts.length, max)) {
    throw new HttpError(429, "Too many requests. Please wait a minute and try again.");
  }
}
