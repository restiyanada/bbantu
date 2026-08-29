import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../_shared/db.ts";
import { handleCors } from "../_shared/cors.ts";
import { HttpError, json, errorResponse } from "../_shared/http.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { orders, pushSubscriptions } from "../../../db/schema.ts";

const hashAccessToken = (raw: string) => sql`encode(digest(${raw}, 'sha256'), 'hex')`;

const subscriptionShape = z.object({
  endpoint: z.string().trim().min(1),
  keys: z.object({
    p256dh: z.string().trim().min(1),
    auth: z.string().trim().min(1),
  }),
});

const subscribeSchema = z.discriminatedUnion("kind", [
  subscriptionShape.extend({ kind: z.literal("ADMIN") }),
  subscriptionShape.extend({ kind: z.literal("CUSTOMER"), accessToken: z.string().trim().min(1) }),
]);

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  let input: z.infer<typeof subscribeSchema>;
  try {
    input = subscribeSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return json({ error: "Invalid request.", details: err.issues }, 400);
    }
    return json({ error: "Invalid JSON body." }, 400);
  }

  try {
    if (input.kind === "ADMIN") {
      // Any admin can opt into notifications — this isn't gated by a specific
      // permission, since "tell me about new orders/payments" isn't itself a
      // capability to manage anything.
      const admin = await requireAdmin(req, null);

      await db
        .insert(pushSubscriptions)
        .values({
          kind: "ADMIN",
          adminId: admin.id,
          endpoint: input.endpoint,
          p256dh: input.keys.p256dh,
          authKey: input.keys.auth,
        })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: { kind: "ADMIN", adminId: admin.id, orderId: null, p256dh: input.keys.p256dh, authKey: input.keys.auth },
        });

      return json({ subscribed: true });
    }

    // Same shape of risk as get-order — a caller who only has an order's
    // access token, guessed or brute-forced (§16.1/§19).
    await enforceRateLimit(req, "push-subscribe");

    const [order] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.accessToken, hashAccessToken(input.accessToken)));

    if (!order) {
      throw new HttpError(404, "Order not found.");
    }

    await db
      .insert(pushSubscriptions)
      .values({
        kind: "CUSTOMER",
        orderId: order.id,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        authKey: input.keys.auth,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { kind: "CUSTOMER", orderId: order.id, adminId: null, p256dh: input.keys.p256dh, authKey: input.keys.auth },
      });

    return json({ subscribed: true });
  } catch (err) {
    return errorResponse(err, "Unexpected error subscribing to push notifications.");
  }
});
