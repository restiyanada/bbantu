import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../_shared/db.ts";
import { handleCors } from "../_shared/cors.ts";
import { HttpError, json, errorResponse } from "../_shared/http.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { payments, orders, orderItems, inventory, inventoryTransactions, customers } from "../../../db/schema.ts";
import { transitionOrder } from "../../../lib/orders.ts";
import { logAudit } from "../../../lib/audit.ts";
import { queueEmail } from "../../../lib/email-queue.ts";

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
    const admin = await requireAdmin(req, "canVerifyPayments");

    const result = await db.transaction(async (tx) => {
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
            createdBy: admin.id,
          });
        }

        return true;
      }

      const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId));
      if (!order) {
        throw new HttpError(404, "Order not found.");
      }

      const [customer] = await tx.select().from(customers).where(eq(customers.id, order.customerId));

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
            verifiedBy: admin.id,
            verifiedAt: new Date(),
          })
          .where(eq(payments.id, payment.id));

        await logAudit(tx, {
          actorId: admin.id,
          entityType: "payment",
          entityId: payment.id,
          action: "payment rejected",
          before: { status: "PENDING" },
          after: { status: "REJECTED", rejectionReason: input.rejectionReason },
        });

        await queueEmail(tx, {
          orderId: order.id,
          toAddress: customer.email,
          template: "PAYMENT_REJECTED",
          priority: "P0",
        });

        return { orderStatus: null as string | null };
      }

      if (order.status !== "PAYMENT_PENDING" && order.status !== "BALANCE_DUE") {
        throw new HttpError(409, `Order is in ${order.status} — nothing to verify.`);
      }

      await tx
        .update(payments)
        .set({ status: "VERIFIED", verifiedBy: admin.id, verifiedAt: new Date() })
        .where(eq(payments.id, payment.id));

      await tx
        .update(orders)
        .set({ amountPaid: sql`${orders.amountPaid} + ${payment.amount}` })
        .where(eq(orders.id, input.orderId));

      await logAudit(tx, {
        actorId: admin.id,
        entityType: "payment",
        entityId: payment.id,
        action: order.status === "BALANCE_DUE" ? "balance payment verified" : "payment verified",
        before: { status: "PENDING" },
        after: { status: "VERIFIED" },
      });

      if (order.status === "BALANCE_DUE") {
        const { to } = await transitionOrder(tx, {
          orderId: input.orderId,
          event: "BALANCE_PAYMENT_VERIFIED",
          actorId: admin.id,
          stockAvailable: true,
        });
        return { orderStatus: to as string | null };
      }

      await transitionOrder(tx, {
        orderId: input.orderId,
        event: "PAYMENT_VERIFIED",
        actorId: admin.id,
        stockAvailable: true,
      });

      await queueEmail(tx, {
        orderId: order.id,
        toAddress: customer.email,
        template: "ORDER_CONFIRMED",
        priority: "P1",
      });

      if (order.salesMode === "READY_STOCK") {
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
          actorId: admin.id,
          stockAvailable: true,
        });

        const { to } = await transitionOrder(tx, {
          orderId: input.orderId,
          event: "STOCK_STATUS_EVALUATED",
          actorId: admin.id,
          stockAvailable: true,
        });

        return { orderStatus: to as string | null };
      }

      await transitionOrder(tx, {
        orderId: input.orderId,
        event: "RESERVATION_ALLOCATED",
        actorId: admin.id,
        stockAvailable: true,
      });

      await tx.update(orders).set({ reservedAt: new Date() }).where(eq(orders.id, input.orderId));

      const alreadyAvailable = await tryAllocatePhysicalReservation(input.orderId);

      const { to } = await transitionOrder(tx, {
        orderId: input.orderId,
        event: "STOCK_STATUS_EVALUATED",
        actorId: admin.id,
        stockAvailable: alreadyAvailable,
      });

      if (to === "BALANCE_DUE") {
        await queueEmail(tx, {
          orderId: order.id,
          toAddress: customer.email,
          template: "BALANCE_DUE",
          priority: "P0",
        });
      }

      return { orderStatus: to as string | null };
    });

    return json({ orderId: input.orderId, decision: input.decision, orderStatus: result.orderStatus });
  } catch (err) {
    return errorResponse(err, "Unexpected error verifying payment.");
  }
});
