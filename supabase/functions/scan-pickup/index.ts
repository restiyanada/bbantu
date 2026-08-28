/**
 * POST /scan-pickup — staff scans/looks up a pickup code and, optionally,
 * confirms the pickup (§13).
 *
 * Three input shapes:
 *   { token }                 → look up by pickup code, no state change
 *   { token, confirm: true }  → transitions READY_FOR_PICKUP → PICKED_UP
 *   { phone }                 → search fallback: lists READY_FOR_PICKUP
 *                                orders for that phone number, each with its
 *                                own pickup token, so staff can pick the
 *                                right one and re-call with { token } to see
 *                                full details / confirm. Phone alone never
 *                                confirms a pickup directly (§27 — phone
 *                                numbers aren't secret, so they're a search
 *                                shortcut, not proof of identity).
 *
 * Two-phase by design for the token path, matching §13.2 ("staff must
 * explicitly confirm the pickup" as a deliberate action after reviewing
 * order details, not automatic on scan).
 *
 * §26 "Invalid QR must produce a safe error without revealing customer
 * information" — an unknown token gets a generic error, nothing else.
 * §13.3 "Already-picked-up QR must never release goods a second time" —
 * enforced by transitionOrder itself: PICKUP_CONFIRMED isn't a valid event
 * from PICKED_UP, so a repeat confirm throws OrderTransitionError → 409.
 *
 * ⚠️ §13.3 also requires unauthenticated scan sessions to see only a generic
 * "Login required" message — nothing else. Milestone 4: requireAdmin throws
 * HttpError(401) for that case (no session at all), which errorResponse maps
 * to a 401 with a generic message — the frontend ScanPage shows its own
 * "Login required" UI on any 401, never surfacing order data. A logged-in
 * admin without canScanConfirmPickup gets a 403 instead (they're staff, just
 * not permitted for this action — a different case from "not logged in").
 */

import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "../_shared/db.ts";
import { handleCors } from "../_shared/cors.ts";
import { HttpError, json, errorResponse } from "../_shared/http.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { pickupTokens, orders, customers, orderItems, productVariants, payments } from "../../../db/schema.ts";
import { transitionOrder } from "../../../lib/orders.ts";

const scanSchema = z.union([
  z.object({
    token: z.string().min(1),
    confirm: z.boolean().optional().default(false),
  }),
  z.object({
    phone: z.string().trim().min(1),
  }),
]);

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
    const admin = await requireAdmin(req, "canScanConfirmPickup");

    if ("phone" in input) {
      const matches = await db
        .select({
          orderId: orders.id,
          orderNumber: orders.orderNumber,
          pickupToken: pickupTokens.token,
          customerName: customers.name,
        })
        .from(orders)
        .innerJoin(customers, eq(orders.customerId, customers.id))
        .innerJoin(pickupTokens, eq(pickupTokens.orderId, orders.id))
        .where(and(eq(customers.phone, input.phone), eq(orders.status, "READY_FOR_PICKUP")));

      return json({ matches });
    }

    const outcome = await db.transaction(async (tx) => {
      const [pickupToken] = await tx.select().from(pickupTokens).where(eq(pickupTokens.token, input.token));
      if (!pickupToken) {
        throw new HttpError(404, "Invalid pickup code.");
      }

      const [order] = await tx.select().from(orders).where(eq(orders.id, pickupToken.orderId));
      if (!order) {
        throw new HttpError(404, "Invalid pickup code.");
      }

      if (input.confirm) {
        await transitionOrder(tx, {
          orderId: order.id,
          event: "PICKUP_CONFIRMED",
          actorId: admin.id,
          stockAvailable: true, // unused by this transition
        });
        // Milestone 6 (§8/§19 retention clock) — see db/schema.ts's
        // fulfilledAt comment for why this is its own column/stamp site
        // rather than something transitionOrder sets centrally.
        await tx.update(orders).set({ fulfilledAt: new Date() }).where(eq(orders.id, order.id));
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
        orderNumber: order.orderNumber,
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
    return errorResponse(err, "Unexpected error scanning pickup code.");
  }
});
