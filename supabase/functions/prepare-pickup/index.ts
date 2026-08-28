/**
 * POST /prepare-pickup — admin marks a READY_FOR_FULFILMENT order as staged
 * and ready, generating its pickup QR token (§13, §14).
 *
 * Modeled as a distinct admin action from verify-payment because the state
 * machine (lib/order-state-machine.ts) treats READY_FOR_FULFILMENT and
 * READY_FOR_PICKUP as separate states with their own event
 * (PREPARE_FOR_FULFILMENT) — "payment/reservation settled" and "physically
 * staged for pickup" are different facts, even though for ready-stock items
 * they often happen close together in practice.
 *
 * Milestone 4: requires a real Supabase Auth session. This endpoint branches
 * on the order's own fulfilment method internally (§13.1), so which §18.4
 * permission it demands branches the same way: canScanConfirmPickup for a
 * PICKUP order, canManageShipping for a SHIPPING one ("pack orders" in the
 * §18.4 permission table is exactly this step for the shipping path — this
 * function marks it READY_TO_SHIP, matching record-tracking's later step
 * which already requires canManageShipping). Checked *before* the state
 * transition runs, from the order's current fulfilmentMethod, so an admin
 * lacking the right permission never causes the transition's side effects.
 */

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../_shared/db.ts";
import { handleCors } from "../_shared/cors.ts";
import { HttpError, json, errorResponse, isUniqueViolation } from "../_shared/http.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { orders, pickupTokens, customers } from "../../../db/schema.ts";
import { transitionOrder } from "../../../lib/orders.ts";
import { queueEmail } from "../../../lib/email-queue.ts";

const prepareSchema = z.object({ orderId: z.string().uuid() });

// Short (not a full UUID) so staff can type it as a manual fallback if the
// camera doesn't work — 6 chars from a 32-symbol alphabet is ~1 billion
// combinations, comfortably unguessable for a booth-pickup code (§13.3)
// without being painful to type. Alphabet excludes 0/O/1/I/L to avoid
// characters that look alike when handwritten or read off a phone screen.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generatePickupCode(length = 6): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  let input: z.infer<typeof prepareSchema>;
  try {
    input = prepareSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return json({ error: "Invalid request.", details: err.issues }, 400);
    }
    return json({ error: "Invalid JSON body." }, 400);
  }

  try {
    const [orderRow] = await db.select({ fulfilmentMethod: orders.fulfilmentMethod }).from(orders).where(eq(orders.id, input.orderId));
    if (!orderRow) {
      throw new HttpError(404, "Order not found.");
    }

    const admin = await requireAdmin(req, orderRow.fulfilmentMethod === "SHIPPING" ? "canManageShipping" : "canScanConfirmPickup");

    const result = await db.transaction(async (tx) => {
      const { to } = await transitionOrder(tx, {
        orderId: input.orderId,
        event: "PREPARE_FOR_FULFILMENT",
        actorId: admin.id,
        stockAvailable: true, // unused by this transition
      });

      // §17.1 — "ready for fulfilment", P1. One email covers both outcomes
      // below (pickup QR or shipping) — queued here, once, before they
      // branch, rather than duplicated in each branch.
      const [order] = await tx
        .select({ customerId: orders.customerId })
        .from(orders)
        .where(eq(orders.id, input.orderId));
      if (order) {
        const [customer] = await tx.select({ email: customers.email }).from(customers).where(eq(customers.id, order.customerId));
        if (customer) {
          await queueEmail(tx, {
            orderId: input.orderId,
            toAddress: customer.email,
            template: "READY_FOR_FULFILMENT",
            priority: "P1",
          });
        }
      }

      if (to !== "READY_FOR_PICKUP") {
        // SHIPPING orders land on READY_TO_SHIP instead — no QR needed here.
        // Shipping's own prep flow (packing, labels) is Milestone 3.
        return { status: to, pickupToken: null as string | null };
      }

      // Astronomically unlikely to collide (~1 billion combinations), but
      // the retry is cheap insurance against the unique constraint on
      // pickup_tokens.token.
      let token = "";
      for (let attempt = 0; attempt < 5; attempt++) {
        token = generatePickupCode();
        try {
          await tx.insert(pickupTokens).values({ orderId: input.orderId, token });
          break;
        } catch (err) {
          if (isUniqueViolation(err) && attempt < 4) continue;
          throw err;
        }
      }

      return { status: to, pickupToken: token };
    });

    return json({ orderId: input.orderId, ...result });
  } catch (err) {
    return errorResponse(err, "Unexpected error preparing order for pickup.");
  }
});
