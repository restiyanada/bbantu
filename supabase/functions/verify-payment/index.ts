/**
 * POST /verify-payment — admin verifies or rejects a submitted payment (§8.3).
 *
 * Handles two different payment rows through the same endpoint, since both
 * are just "the one PENDING payment row for this order" from the DB's point
 * of view — only the order's *current status* tells them apart:
 *
 *   - order.status === "PAYMENT_PENDING" → this is the initial/deposit
 *     payment (READY_STOCK+FULL, or PRE_ORDER+FULL/DP).
 *   - order.status === "BALANCE_DUE"     → this is a DP order's remaining
 *     balance (Milestone 2, submitted via submit-balance-payment).
 *
 * On VERIFY, sales mode changes what "allocate the reservation" means:
 *
 *   - READY_STOCK: physical stock must already be on hand (§5.2) — checked
 *     and reserved immediately, same as Milestone 1. Throws if insufficient
 *     (shouldn't normally happen; create-order already checked, but stock
 *     can be claimed by another order in the interim).
 *   - PRE_ORDER: §11.2 — commitments are tracked *before* physical stock
 *     exists. Verifying the deposit does NOT touch `inventory` at all; it
 *     just advances the order to RESERVED/AWAITING_STOCK and stamps
 *     `reservedAt` (the §26 shortfall-ranking key). The one exception: if
 *     this batch's stock already happens to be on hand (e.g. a late deposit
 *     verification after the batch already received stock), allocate and
 *     promote immediately instead of parking it in AWAITING_STOCK for no
 *     reason. The normal case — stock arriving after the fact — is handled
 *     by supabase/functions/record-batch-receipt, not here.
 *
 * BALANCE_DUE verification never touches inventory — that already happened
 * either at initial verification (READY_STOCK) or at receipt time
 * (PRE_ORDER, record-batch-receipt). It just marks the order fulfilment-ready.
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
      // §11.2 "customer commitments are allocated first" — checks every
      // item on the order against current on-hand/available, and only if
      // *all* of them clear does it actually write the reservation. Returns
      // false (no writes at all) rather than throwing, so the two call
      // sites below can each decide what "not available yet" means for
      // their sales mode. Declared inside the transaction closure so `tx`'s
      // type is inferred from `db.transaction(...)` rather than hand-rolled.
      async function tryAllocatePhysicalReservation(orderId: string): Promise<boolean> {
        const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));

        for (const item of items) {
          const [stock] = await tx
            .select()
            .from(inventory)
            .where(eq(inventory.variantId, item.variantId))
            .for("update");

          const available = (stock?.onHand ?? 0) - (stock?.reserved ?? 0);
          if (item.quantity > available) return false;
        }

        for (const item of items) {
          await tx
            .update(inventory)
            .set({ reserved: sql`${inventory.reserved} + ${item.quantity}` })
            .where(eq(inventory.variantId, item.variantId));

          await tx.insert(inventoryTransactions).values({
            variantId: item.variantId,
            quantityDelta: -item.quantity,
            reason: `Reservation allocated for order ${orderId}`,
            createdBy: HARDCODED_ADMIN_ID,
          });
        }

        return true;
      }

      const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId));
      if (!order) {
        throw new HttpError(404, "Order not found.");
      }

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
        // order simply stays in whatever status it was already in
        // (PAYMENT_PENDING or BALANCE_DUE) so the customer can resubmit (§26).
        return { orderStatus: null as string | null };
      }

      // decision === "VERIFY"
      if (order.status !== "PAYMENT_PENDING" && order.status !== "BALANCE_DUE") {
        throw new HttpError(409, `Order is in ${order.status} — nothing to verify.`);
      }

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
        action: order.status === "BALANCE_DUE" ? "balance payment verified" : "payment verified",
        before: { status: "PENDING" },
        after: { status: "VERIFIED" },
      });

      // ── Balance payment (DP order's remaining amount) ──
      if (order.status === "BALANCE_DUE") {
        const { to } = await transitionOrder(tx, {
          orderId: input.orderId,
          event: "BALANCE_PAYMENT_VERIFIED",
          actorId: HARDCODED_ADMIN_ID,
          stockAvailable: true, // unused by this transition
        });
        return { orderStatus: to as string | null };
      }

      // ── Initial payment (PAYMENT_PENDING → …) ──
      await transitionOrder(tx, {
        orderId: input.orderId,
        event: "PAYMENT_VERIFIED",
        actorId: HARDCODED_ADMIN_ID,
        stockAvailable: true, // not evaluated until STOCK_STATUS_EVALUATED below; unused by this transition
      });

      if (order.salesMode === "READY_STOCK") {
        // Ready stock must physically exist by definition (§5.2) — re-check
        // now rather than trusting create-order's check, since another order
        // may have been verified (and reserved stock) first in the interim.
        const allocated = await tryAllocatePhysicalReservation(input.orderId);
        if (!allocated) {
          throw new HttpError(
            409,
            "Cannot allocate reservation — insufficient stock for one of the items. Payment was not verified."
          );
        }

        await transitionOrder(tx, {
          orderId: input.orderId,
          event: "RESERVATION_ALLOCATED",
          actorId: HARDCODED_ADMIN_ID,
          stockAvailable: true,
        });

        const { to } = await transitionOrder(tx, {
          orderId: input.orderId,
          event: "STOCK_STATUS_EVALUATED",
          actorId: HARDCODED_ADMIN_ID,
          stockAvailable: true, // ready stock is on hand by definition
        });

        return { orderStatus: to as string | null };
      }

      // ── PRE_ORDER: commitment tracked before physical stock exists (§11.2) ──
      await transitionOrder(tx, {
        orderId: input.orderId,
        event: "RESERVATION_ALLOCATED",
        actorId: HARDCODED_ADMIN_ID,
        stockAvailable: true, // unused by this transition
      });

      // §26 ranking key — stamped once, right as the order becomes a
      // tracked commitment. record-batch-receipt sorts on this later.
      await tx.update(orders).set({ reservedAt: new Date() }).where(eq(orders.id, input.orderId));

      // Edge case, not the normal path: this batch's stock might already be
      // on hand (e.g. a late deposit verification after the batch already
      // received stock). If so, allocate and promote right now instead of
      // parking it in AWAITING_STOCK to wait for a receipt that already
      // happened. The normal case — stock arriving later — is NOT handled
      // here; see supabase/functions/record-batch-receipt.
      const alreadyAvailable = await tryAllocatePhysicalReservation(input.orderId);

      const { to } = await transitionOrder(tx, {
        orderId: input.orderId,
        event: "STOCK_STATUS_EVALUATED",
        actorId: HARDCODED_ADMIN_ID,
        stockAvailable: alreadyAvailable,
      });

      return { orderStatus: to as string | null };
    });

    return json({ orderId: input.orderId, decision: input.decision, orderStatus: result.orderStatus });
  } catch (err) {
    return errorResponse(err, "Unexpected error verifying payment.");
  }
});
