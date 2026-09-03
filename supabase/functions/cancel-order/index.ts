import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../_shared/db.ts";
import { handleCors } from "../_shared/cors.ts";
import { HttpError, json, errorResponse } from "../_shared/http.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { orders } from "../../../db/schema.ts";
import { transitionOrder } from "../../../lib/orders.ts";
import { releaseReservation } from "../../../lib/reservation.ts";
import { logAudit } from "../../../lib/audit.ts";
import { notifyOrder } from "../_shared/push.ts";

const cancelOrderSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string().trim().min(1, "A cancellation reason is required."),
});

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  let input: z.infer<typeof cancelOrderSchema>;
  try {
    input = cancelOrderSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return json({ error: "Invalid request.", details: err.issues }, 400);
    }
    return json({ error: "Invalid JSON body." }, 400);
  }

  try {
    // Cancellation can void a verified payment, so it sits with the money
    // permission rather than a new one of its own — see task brief.
    const admin = await requireAdmin(req, "canVerifyPayments");

    const result = await db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId)).for("update");
      if (!order) {
        throw new HttpError(404, "Order not found.");
      }

      // Let the state machine decide whether CANCEL is legal from this
      // status — do not pre-check CANCELLABLE_STATES here. transitionOrder
      // re-selects/re-locks the same row (already held above, so this is a
      // no-op re-acquire, not a second lock) and throws OrderTransitionError
      // for an illegal transition, which errorResponse maps to a 409.
      const { from } = await transitionOrder(tx, {
        orderId: input.orderId,
        event: "CANCEL",
        actorId: admin.id,
        stockAvailable: true,
      });

      // stockReservedAt — not reservedAt — is the only correct signal for
      // whether this order currently holds an inventory.reserved increment.
      // Only release (and only clear the flag) when it's set; clearing it
      // is what makes a second cancel of the same order a no-op instead of
      // a double-release, on top of transitionOrder already rejecting a
      // second CANCEL once the order is already CANCELLED.
      const stockReleased = order.stockReservedAt !== null;
      if (stockReleased) {
        await releaseReservation(tx, {
          orderId: input.orderId,
          actorId: admin.id,
          reason: `Reservation released — order cancelled: ${input.reason}`,
        });
        await tx.update(orders).set({ stockReservedAt: null }).where(eq(orders.id, input.orderId));
      }

      await logAudit(tx, {
        actorId: admin.id,
        entityType: "order",
        entityId: input.orderId,
        action: "order cancelled",
        before: { status: from },
        after: { status: "CANCELLED", reason: input.reason, stockReleased },
      });

      return { status: "CANCELLED" as const, stockReleased };
    });

    // Fire-and-forget, matching prepare-pickup / record-tracking — never
    // await a push send inside the request/response path.
    notifyOrder(input.orderId, {
      title: "Order cancelled",
      body: `Your order has been cancelled: ${input.reason}`,
    });

    return json({ orderId: input.orderId, ...result });
  } catch (err) {
    return errorResponse(err, "Unexpected error cancelling order.");
  }
});
