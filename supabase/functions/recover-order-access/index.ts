import { eq, and, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../_shared/db.ts";
import { handleCors } from "../_shared/cors.ts";
import { json, errorResponse, getClientIp } from "../_shared/http.ts";
import { customers, orders, accessRecoveryAttempts } from "../../../db/schema.ts";
import { isRateLimited, windowStart } from "../../../lib/rate-limit.ts";
import { formatOrderNumber, parseOrderNumber } from "../../../lib/order-number.ts";

const accessTokenEncKey = Deno.env.get("ACCESS_TOKEN_ENC_KEY");
if (!accessTokenEncKey) {
  throw new Error("ACCESS_TOKEN_ENC_KEY must be set as a Supabase Edge Function secret.");
}

const frontendBaseUrl = Deno.env.get("FRONTEND_BASE_URL");
if (!frontendBaseUrl) {
  throw new Error("FRONTEND_BASE_URL must be set as a Supabase Edge Function secret.");
}

const PHONE_PATTERN = /^[0-9]{8,15}$/;

const recoverySchema = z.object({
  phone: z.string().trim().regex(PHONE_PATTERN, "Phone number must be 8–15 digits, numbers only."),
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

