import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../_shared/db.ts";
import { handleCors } from "../_shared/cors.ts";
import { HttpError, json, errorResponse } from "../_shared/http.ts";
import { orders, payments } from "../../../db/schema.ts";
import { logAudit } from "../../../lib/audit.ts";
import { notifyAdmins } from "../_shared/push.ts";
import { formatOrderNumber } from "../../../lib/order-number.ts";

const hashAccessToken = (raw: string) => sql`encode(digest(${raw}, 'sha256'), 'hex')`;

const submitBalanceSchema = z.object({
  orderId: z.string().uuid(),
  accessToken: z.string().min(1),
  proofFileUrl: z.string().min(1, "Payment proof is required."),
});

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  let input: z.infer<typeof submitBalanceSchema>;
  try {
    input = submitBalanceSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return json({ error: "Invalid request.", details: err.issues }, 400);
    }
    return json({ error: "Invalid JSON body." }, 400);
  }

  const proofRows = await db.execute<{ exists: number }>(
    sql`select 1 as exists from storage.objects where bucket_id = 'payment-proofs' and name = ${input.proofFileUrl} limit 1`
  );
  if (proofRows.length === 0) {
    return json(
      { error: "We couldn't find your uploaded payment proof. Please upload it again before submitting." },
      400
    );
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.id, input.orderId), eq(orders.accessToken, hashAccessToken(input.accessToken))));

      if (!order) {
        throw new HttpError(404, "Order not found.");
      }

      if (order.status !== "BALANCE_DUE") {
        throw new HttpError(409, "This order doesn't have a balance due right now.");
      }

      const [existingPending] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.orderId, order.id), eq(payments.status, "PENDING")));

      if (existingPending) {
        throw new HttpError(409, "A balance payment for this order is already awaiting review.");
      }

      const [latestPayment] = await tx
        .select()
        .from(payments)
        .where(eq(payments.orderId, order.id))
        .orderBy(desc(payments.submittedAt))
        .limit(1);

      const balanceAmount = (Number(order.merchandiseSubtotal) - Number(order.amountPaid)).toFixed(2);

      const [newPayment] = await tx
        .insert(payments)
        .values({
          orderId: order.id,
          amount: balanceAmount,
          proofFileUrl: input.proofFileUrl,
          status: "PENDING",
        })
        .returning();

      await logAudit(tx, {
        actorId: null,
        entityType: "payment",
        entityId: newPayment.id,
        action: "customer submitted balance payment",
        before: latestPayment ? { previousPaymentId: latestPayment.id } : undefined,
        after: { status: "PENDING", amount: balanceAmount },
      });

      return { paymentId: newPayment.id, order };
    });

    notifyAdmins({
      title: "Balance payment submitted",
      body: `Order ${formatOrderNumber(result.order.fulfilmentMethod, result.order.orderNumber, result.order.id)} has a balance payment awaiting review`,
    });

    return json({ paymentId: result.paymentId }, 201);
  } catch (err) {
    return errorResponse(err, "Unexpected error submitting balance payment.");
  }
});
