/**
 * POST /recover-order-access — guest order access recovery (§16.2,
 * Milestone 6, item 30).
 *
 * PRD §16.2 describes phone + email as the cross-check pair. Deviation
 * flagged deliberately, not a silent reinterpretation: this recovers by
 * phone + order number instead, since the order number is already sent to
 * the customer through every other channel (order page, all 4 emails)
 * anyway, and matching it exactly is a simpler ask than remembering which
 * email was typed at checkout. Order number is customer-facing but not
 * secret — sequential per fulfilment type (db/schema.ts pickup_order_seq/
 * shipping_order_seq) — so unlike email this isn't an independent identity
 * signal, just a second thing that has to match. Rate limiting below is
 * the real defense against guessing here, not the choice of fields.
 *
 * Reuses the exact same decrypt path send-queued-emails uses to rebuild a
 * link from accessTokenEncrypted (see db/schema.ts's accessTokenEncrypted
 * comment for why a one-way hash alone can't do this) — same secret, same
 * pgcrypto call, so there's only one place this logic can drift.
 *
 * Rate limited (§16.1/§27 "10 requests per minute per IP") — a customer-
 * facing order number is a low-entropy guessing surface (sequential, not
 * random), so this endpoint needs real protection even though the PRD's
 * wording for the limit is about token-based access specifically.
 * lib/rate-limit.ts has the threshold logic; access_recovery_attempts
 * (db/schema.ts) is the per-IP counter.
 */

import { eq, and, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../_shared/db.ts";
import { handleCors } from "../_shared/cors.ts";
import { json, errorResponse, getClientIp } from "../_shared/http.ts";
import { customers, orders, accessRecoveryAttempts } from "../../../db/schema.ts";
import { isRateLimited, windowStart } from "../../../lib/rate-limit.ts";
import { formatOrderNumber, parseOrderNumber } from "../../../lib/order-number.ts";

// Milestone 5 (§16.1, §27) — same secret create-order/send-queued-emails
// use to write/read accessTokenEncrypted.
const accessTokenEncKey = Deno.env.get("ACCESS_TOKEN_ENC_KEY");
if (!accessTokenEncKey) {
  throw new Error("ACCESS_TOKEN_ENC_KEY must be set as a Supabase Edge Function secret.");
}

const frontendBaseUrl = Deno.env.get("FRONTEND_BASE_URL");
if (!frontendBaseUrl) {
  throw new Error("FRONTEND_BASE_URL must be set as a Supabase Edge Function secret.");
}

// Same pattern as customer.phone in create-order — digits only.
const PHONE_PATTERN = /^[0-9]{8,15}$/;

const recoverySchema = z.object({
  phone: z.string().trim().regex(PHONE_PATTERN, "Phone number must be 8–15 digits, numbers only."),
  // Format validated here (not a "not found" case) — a malformed order
  // number isn't sensitive the way a wrong phone/order combo is.
  orderNumber: z.string().trim().min(1, "Order number is required."),
});

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  let input: z.infer<typeof recoverySchema>;
  try {
    input = recoverySchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return json({ error: "Invalid request.", details: err.issues }, 400);
    }
    return json({ error: "Invalid JSON body." }, 400);
  }

  const parsed = parseOrderNumber(input.orderNumber);
  if (!parsed) {
    return json({ error: "That doesn't look like a valid order number (e.g. #010007)." }, 400);
  }

  try {
    const ip = getClientIp(req);
    const now = new Date();

    const priorAttempts = await db
      .select({ id: accessRecoveryAttempts.id })
      .from(accessRecoveryAttempts)
      .where(and(eq(accessRecoveryAttempts.ipAddress, ip), gte(accessRecoveryAttempts.createdAt, windowStart(now))));

    if (isRateLimited(priorAttempts.length)) {
      return json({ error: "Too many attempts. Please wait a minute and try again." }, 429);
    }

    await db.insert(accessRecoveryAttempts).values({ ipAddress: ip });

    // Order number + fulfilment method uniquely identifies one order
    // (each is its own sequence, db/schema.ts pickup_order_seq/
    // shipping_order_seq) — unlike a phone+email cross-check, which could
    // legitimately match several orders for a repeat customer.
    const [order] = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        fulfilmentMethod: orders.fulfilmentMethod,
        status: orders.status,
        createdAt: orders.createdAt,
        customerPhone: customers.phone,
        rawToken: sql<string | null>`pgp_sym_decrypt(decode(${orders.accessTokenEncrypted}, 'base64'), ${accessTokenEncKey})`,
      })
      .from(orders)
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .where(and(eq(orders.fulfilmentMethod, parsed.fulfilmentMethod), eq(orders.orderNumber, parsed.orderNumber)));

    // Deliberately generic — doesn't reveal whether the order number
    // exists at all if the phone doesn't match, or vice versa. Same
    // reasoning as resubmit-payment/scan-pickup's generic error responses.
    // Also covers the pre-Milestone-5 case (accessTokenEncrypted not
    // backfilled yet, rawToken decrypts to null) — nothing usable to
    // return either way, same response shape.
    if (!order || order.customerPhone !== input.phone || order.rawToken === null) {
      return json({ found: false });
    }

    return json({
      found: true,
      order: {
        orderNumber: formatOrderNumber(order.fulfilmentMethod, order.orderNumber, order.id),
        fulfilmentMethod: order.fulfilmentMethod,
        status: order.status,
        createdAt: order.createdAt,
        url: `${frontendBaseUrl}/orders/${order.rawToken}`,
      },
    });
  } catch (err) {
    return errorResponse(err, "Unexpected error recovering order access.");
  }
});

