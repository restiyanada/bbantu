/**
 * POST /verify-payment — admin verifies or rejects a submitted payment (§8.3).
 *
 * Milestone 1 scope: READY_STOCK + FULL payment orders only. On VERIFY, this
 * chains three deterministic transitions (payment verified → reservation
 * allocated → stock status evaluated) because for this specific combination
 * none of them need separate admin input — verifying the payment is the one
 * decision point. It stops at READY_FOR_FULFILMENT: moving on to
 * READY_FOR_PICKUP (and issuing the pickup QR token) is a distinct real-world
 * action — "staging the order for pickup" — handled by prepare-pickup
 * (Milestone 1 step 5), not bundled in here.
 *
 * ⚠️ NOT SECURE YET. Per milestone.md: "No real auth yet, just a hardcoded
 * admin id for now — Supabase Auth comes in Milestone 4." This function has
 * no admin authentication or authorization check. `verify_jwt` is globally
 * false for this project (supabase/config.toml), so ANYONE with the public
 * anon key can currently call this and verify/reject any payment. Do not
 * expose this function's URL outside trusted testing until Milestone 4 adds
 * real Supabase Auth + the §18.4 canVerifyPayments permission check.
 */

import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../_shared/db.ts";
import { handleCors } from "../_shared/cors.ts";
import { HttpError, json, errorResponse } from "../_shared/http.ts";
import { payments, orders, orderItems, inventory, inventoryTransactions } from "../../../db/schema.ts";
import { transitionOrder } from "../../../lib/orders.ts";
import { logAudit } from "../../../lib/audit.ts";

// Milestone 4 replaces this with the authenticated admin's ID from the
// Supabase Auth session (and checks admin_users.canVerifyPayments).
const HARDCODED_ADMIN_ID = "00000000-0000-0000-0000-000000000001";

const verifyPaymentSchema = z.discriminatedUnion("decision", [
  z.object({ orderId: z.string().uuid(), decision: z.literal("VERIFY") }),
  z.object({
    orderId: z.string().uuid(),
    decision: z.literal("REJECT"),
    rejectionReason: z.string().trim().min(1, "A rejection reason is required."),
  }),
]);

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  let input: z.infer<typeof verifyPaymentSchema>;
  try {
    input = verifyPaymentSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return json({ error: "Invalid request.", details: err.issues }, 400);
    }
    return json({ error: "Invalid JSON body." }, 400);
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [payment] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.orderId, input.orderId), eq(payments.status, "PENDING")));

      if (!payment) {
        throw new HttpError(409, "No pending payment to verify for this order.");
      }

      if (input.decision === "REJECT") {
        await tx
          .update(payments)
          .set({
            status: "REJECTED",
            rejectionReason: input.rejectionReason,
            verifiedBy: HARDCODED_ADMIN_ID,
            verifiedAt: new Date(),
          })
          .where(eq(payments.id, payment.id));

        await logAudit(tx, {
          actorId: HARDCODED_ADMIN_ID,
          entityType: "payment",
          entityId: payment.id,
          action: "payment rejected",
          before: { status: "PENDING" },
          after: { status: "REJECTED", rejectionReason: input.rejectionReason },
        });

        // No order-state-machine event exists for "payment rejected" — the
        // order simply stays PAYMENT_PENDING so the customer can resubmit (§26).
        return { orderStatus: null as string | null };
      }

      // decision === "VERIFY"
      await tx
        .update(payments)
        .set({ status: "VERIFIED", verifiedBy: HARDCODED_ADMIN_ID, verifiedAt: new Date() })
        .where(eq(payments.id, payment.id));

      // §16 — the order page needs an accurate "amount paid" / "balance due",
      // which reads off orders.amountPaid, not the payments table directly.
      await tx
        .update(orders)
        .set({ amountPaid: sql`${orders.amountPaid} + ${payment.amount}` })
        .where(eq(orders.id, input.orderId));

      await logAudit(tx, {
        actorId: HARDCODED_ADMIN_ID,
        entityType: "payment",
        entityId: payment.id,
        action: "payment verified",
        before: { status: "PENDING" },
        after: { status: "VERIFIED" },
      });

      await transitionOrder(tx, {
        orderId: input.orderId,
        event: "PAYMENT_VERIFIED",
        actorId: HARDCODED_ADMIN_ID,
        stockAvailable: true, // not evaluated until STOCK_STATUS_EVALUATED below; unused by this transition
      });

      // Allocate reservation (§11.2 "customer commitments are allocated
      // first"). Re-check availability now rather than trusting the check
      // from order-creation time — other orders may have been verified
      // (and reserved stock) first in the interim.
      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, input.orderId));

      for (const item of items) {
        const [stock] = await tx
          .select()
          .from(inventory)
          .where(eq(inventory.variantId, item.variantId))
          .for("update");

        const available = (stock?.onHand ?? 0) - (stock?.reserved ?? 0);
        if (item.quantity > available) {
          throw new HttpError(
            409,
            "Cannot allocate reservation — insufficient stock for one of the items. Payment was not verified."
          );
        }
      }

      for (const item of items) {
        await tx
          .update(inventory)
          .set({ reserved: sql`${inventory.reserved} + ${item.quantity}` })
          .where(eq(inventory.variantId, item.variantId));

        await tx.insert(inventoryTransactions).values({
          variantId: item.variantId,
          quantityDelta: -item.quantity,
          reason: `Reservation allocated for order ${input.orderId}`,
          createdBy: HARDCODED_ADMIN_ID,
        });
      }

      await transitionOrder(tx, {
        orderId: input.orderId,
        event: "RESERVATION_ALLOCATED",
        actorId: HARDCODED_ADMIN_ID,
        stockAvailable: true,
      });

      // Ready stock is on-hand by definition, so stock is always available here.
      const { to } = await transitionOrder(tx, {
        orderId: input.orderId,
        event: "STOCK_STATUS_EVALUATED",
        actorId: HARDCODED_ADMIN_ID,
        stockAvailable: true,
      });

      return { orderStatus: to as string | null };
    });

    return json({ orderId: input.orderId, decision: input.decision, orderStatus: result.orderStatus });
  } catch (err) {
    return errorResponse(err, "Unexpected error verifying payment.");
  }
});
