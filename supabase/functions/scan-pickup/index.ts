/**
 * POST /scan-pickup — staff scans/looks up a pickup QR token and, optionally,
 * confirms the pickup (§13).
 *
 * Two-phase by design, matching §13.2 ("staff must explicitly confirm the
 * pickup" as a deliberate action after reviewing order details, not
 * automatic on scan):
 *   { token }                 → look up only, no state change
 *   { token, confirm: true }  → transitions READY_FOR_PICKUP → PICKED_UP
 *
 * §26 "Invalid QR must produce a safe error without revealing customer
 * information" — an unknown token gets a generic error, nothing else.
 * §13.3 "Already-picked-up QR must never release goods a second time" —
 * enforced by transitionOrder itself: PICKUP_CONFIRMED isn't a valid event
 * from PICKED_UP, so a repeat confirm throws OrderTransitionError → 409.
 *
 * ⚠️ §13.3 also requires unauthenticated scan sessions to see only a generic
 * "Login required" message — nothing else. This function has no staff-session
 * auth check yet (Milestone 4), so it currently returns real order data to
 * any caller with the anon key. Do not expose this function's URL outside
 * trusted testing until Milestone 4 adds real staff authentication.
 */

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../_shared/db.ts";
import { handleCors } from "../_shared/cors.ts";
import { HttpError, json, errorResponse } from "../_shared/http.ts";
import { pickupTokens, orders, customers, orderItems, productVariants, payments } from "../../../db/schema.ts";
import { transitionOrder } from "../../../lib/orders.ts";

// Milestone 4 replaces this with the authenticated staff member's ID.
const HARDCODED_STAFF_ID = "00000000-0000-0000-0000-000000000001";

const scanSchema = z.object({
  token: z.string().min(1),
  confirm: z.boolean().optional().default(false),
});

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return "*".repeat(digits.length);
  return "*".repeat(digits.length - 4) + digits.slice(-4);
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  let input: z.infer<typeof scanSchema>;
  try {
    input = scanSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return json({ error: "Invalid request.", details: err.issues }, 400);
    }
    return json({ error: "Invalid JSON body." }, 400);
  }

  try {
    const outcome = await db.transaction(async (tx) => {
      const [pickupToken] = await tx.select().from(pickupTokens).where(eq(pickupTokens.token, input.token));
      if (!pickupToken) {
        throw new HttpError(404, "Invalid QR code.");
      }

      const [order] = await tx.select().from(orders).where(eq(orders.id, pickupToken.orderId));
      if (!order) {
        throw new HttpError(404, "Invalid QR code.");
      }

      if (input.confirm) {
        await transitionOrder(tx, {
          orderId: order.id,
          event: "PICKUP_CONFIRMED",
          actorId: HARDCODED_STAFF_ID,
          stockAvailable: true, // unused by this transition
        });
      }

      const [customer] = await tx.select().from(customers).where(eq(customers.id, order.customerId));
      const items = await tx
        .select({ quantity: orderItems.quantity, variantName: productVariants.name })
        .from(orderItems)
        .innerJoin(productVariants, eq(orderItems.variantId, productVariants.id))
        .where(eq(orderItems.orderId, order.id));
      const [payment] = await tx.select().from(payments).where(eq(payments.orderId, order.id));

      const status = input.confirm ? "PICKED_UP" : order.status;

      return {
        orderId: order.id,
        customerName: customer?.name ?? null,
        customerPhoneMasked: customer ? maskPhone(customer.phone) : null,
        items: items.map((item) => ({ name: item.variantName, quantity: item.quantity })),
        paymentStatus: payment?.status ?? null,
        orderStatus: status,
        eligibleForPickup: status === "READY_FOR_PICKUP",
        alreadyPickedUp: status === "PICKED_UP",
        confirmed: input.confirm,
      };
    });

    return json(outcome);
  } catch (err) {
    return errorResponse(err, "Unexpected error scanning pickup token.");
  }
});
