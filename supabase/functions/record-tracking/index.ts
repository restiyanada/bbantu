/**
 * POST /record-tracking — admin records a courier tracking number for a
 * packed shipping order, transitioning READY_TO_SHIP → SHIPPED (§15.3).
 *
 * Optionally corrects the shipment's cost first (§26 "Shipping cost can be
 * manually corrected, but the override must be audited") — a reason is
 * required whenever a cost override is sent, matching how
 * payment-rejection-form.tsx enforces §8.3's "rejection reason required"
 * rule for the same kind of "admin overrides something, must say why" shape.
 *
 * Labeling/printing the shipping sticker (§15.4) is intentionally NOT part
 * of this endpoint or this milestone's scope yet — flagged as a deliberate
 * gap, not an oversight (see architecture.md).
 *
 * Milestone 4: requires a real Supabase Auth session with
 * admin_users.canManageShipping — see supabase/functions/_shared/auth.ts.
 */

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../_shared/db.ts";
import { handleCors } from "../_shared/cors.ts";
import { HttpError, json, errorResponse, centsToDecimalString } from "../_shared/http.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { orders, shipments } from "../../../db/schema.ts";
import { transitionOrder } from "../../../lib/orders.ts";
import { logAudit } from "../../../lib/audit.ts";

const recordTrackingSchema = z
  .object({
    orderId: z.string().uuid(),
    trackingNumber: z.string().trim().min(1, "Tracking number is required."),
    costOverride: z.number().positive().optional(),
    costOverrideReason: z.string().trim().min(1).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.costOverride !== undefined && !val.costOverrideReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["costOverrideReason"],
        message: "A reason is required when overriding the shipping cost (§26).",
      });
    }
  });

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  let input: z.infer<typeof recordTrackingSchema>;
  try {
    input = recordTrackingSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return json({ error: "Invalid request.", details: err.issues }, 400);
    }
    return json({ error: "Invalid JSON body." }, 400);
  }

  try {
    const admin = await requireAdmin(req, "canManageShipping");

    const result = await db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId));
      if (!order) {
        throw new HttpError(404, "Order not found.");
      }
      if (order.fulfilmentMethod !== "SHIPPING") {
        throw new HttpError(409, "This order isn't a shipping order.");
      }

      const [shipment] = await tx.select().from(shipments).where(eq(shipments.orderId, input.orderId));
      if (!shipment) {
        throw new HttpError(404, "No shipment record found for this order.");
      }

      if (input.costOverride !== undefined) {
        const newCost = centsToDecimalString(Math.round(input.costOverride * 100));

        await tx
          .update(shipments)
          .set({ cost: newCost, costOverrideReason: input.costOverrideReason })
          .where(eq(shipments.id, shipment.id));

        // orders.shippingCost is kept in sync with shipments.cost — the
        // customer's order page reads the former directly (no join) for its
        // total, so an override here must update both or the two would
        // silently disagree.
        await tx.update(orders).set({ shippingCost: newCost }).where(eq(orders.id, order.id));

        await logAudit(tx, {
          actorId: admin.id,
          entityType: "shipment",
          entityId: shipment.id,
          action: "shipping cost changed",
          before: { cost: shipment.cost },
          after: { cost: newCost, reason: input.costOverrideReason },
        });
      }

      await tx
        .update(shipments)
        .set({ trackingNumber: input.trackingNumber })
        .where(eq(shipments.id, shipment.id));

      await logAudit(tx, {
        actorId: admin.id,
        entityType: "shipment",
        entityId: shipment.id,
        action: "tracking added",
        after: { trackingNumber: input.trackingNumber },
      });

      // Only valid from READY_TO_SHIP (lib/order-state-machine.ts) — a
      // PICKUP order or one not yet packed is rejected here with a 409,
      // not by a redundant manual status check.
      const { to } = await transitionOrder(tx, {
        orderId: order.id,
        event: "TRACKING_RECORDED",
        actorId: admin.id,
        stockAvailable: true, // unused by this transition
      });

      // Milestone 6 (§8/§19 retention clock) — see db/schema.ts's
      // fulfilledAt comment; same stamp site pattern as scan-pickup's
      // PICKUP_CONFIRMED branch.
      await tx.update(orders).set({ fulfilledAt: new Date() }).where(eq(orders.id, order.id));

      return { status: to };
    });

    return json({ orderId: input.orderId, ...result });
  } catch (err) {
    return errorResponse(err, "Unexpected error recording tracking.");
  }
});
