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

const resubmitSchema = z.object({
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

  let input: z.infer<typeof resubmitSchema>;
  try {
    input = resubmitSchema.parse(await req.json());
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

      const [latestPayment] = await tx
        .select()
        .from(payments)
        .where(eq(payments.orderId, order.id))
        .orderBy(desc(payments.submittedAt))
        .limit(1);

      if (!latestPayment || latestPayment.status !== "REJECTED") {
        throw new HttpError(
          409,
          "This order doesn't have a rejected payment to resubmit."
        );
      }

      const [newPayment] = await tx
        .insert(payments)
        .values({
          orderId: order.id,
          amount: order.merchandiseSubtotal,
          proofFileUrl: input.proofFileUrl,
          status: "PENDING",
        })
        .returning();

      await logAudit(tx, {
        actorId: null,
        entityType: "payment",
        entityId: newPayment.id,
        action: "customer resubmitted payment after rejection",
        before: { previousPaymentId: latestPayment.id },
        after: { status: "PENDING" },
      });

      return { paymentId: newPayment.id, order };
    });

    await notifyAdmins({
      title: "Payment proof submitted",
      body: `Order ${formatOrderNumber(result.order.fulfilmentMethod, result.order.orderNumber, result.order.id)} has a payment awaiting review`,
    });

    return json({ paymentId: result.paymentId }, 201);
  } catch (err) {
    return errorResponse(err, "Unexpected error resubmitting payment.");
  }
});
