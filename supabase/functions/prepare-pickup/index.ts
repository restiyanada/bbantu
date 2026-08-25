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
 * ⚠️ Same auth caveat as verify-payment — no real admin auth until Milestone 4.
 */

import { z } from "zod";
import { db } from "../_shared/db.ts";
import { handleCors } from "../_shared/cors.ts";
import { json, errorResponse } from "../_shared/http.ts";
import { pickupTokens } from "../../../db/schema.ts";
import { transitionOrder } from "../../../lib/orders.ts";

// Milestone 4 replaces this with the authenticated admin's ID.
const HARDCODED_ADMIN_ID = "00000000-0000-0000-0000-000000000001";

const prepareSchema = z.object({ orderId: z.string().uuid() });

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
    const result = await db.transaction(async (tx) => {
      const { to } = await transitionOrder(tx, {
        orderId: input.orderId,
        event: "PREPARE_FOR_FULFILMENT",
        actorId: HARDCODED_ADMIN_ID,
        stockAvailable: true, // unused by this transition
      });

      if (to !== "READY_FOR_PICKUP") {
        // SHIPPING orders land on READY_TO_SHIP instead — no QR needed here.
        // Shipping's own prep flow (packing, labels) is Milestone 3.
        return { status: to, pickupToken: null as string | null };
      }

      const token = crypto.randomUUID();
      await tx.insert(pickupTokens).values({ orderId: input.orderId, token });

      return { status: to, pickupToken: token };
    });

    return json({ orderId: input.orderId, ...result });
  } catch (err) {
    return errorResponse(err, "Unexpected error preparing order for pickup.");
  }
});
