/**
 * POST /resubmit-payment — customer re-uploads proof after a rejected
 * payment (§26 "Payment can be rejected and resubmitted").
 *
 * Customer-facing, not admin-facing — so unlike verify-payment/scan-pickup,
 * this genuinely needs to verify the caller owns the order. The access
 * token (already used for reading the order page, §16/§27) is the proof of
 * ownership: order id alone isn't secret, the access token is.
 *
 * Only allowed when the most recent payment is REJECTED — can't resubmit
 * onto a PENDING (already under review) or VERIFIED payment. Order status
 * doesn't change here: it was never moved off PAYMENT_PENDING by the
 * rejection in the first place (verify-payment's REJECT branch is a no-op
 * on order status), so there's nothing to transition back.
 */

import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../_shared/db.ts";
import { handleCors } from "../_shared/cors.ts";
import { HttpError, json, errorResponse } from "../_shared/http.ts";
import { orders, payments } from "../../../db/schema.ts";
import { logAudit } from "../../../lib/audit.ts";

// Milestone 5 — orders.accessToken now stores a hash, not the raw value
// (see db/schema.ts). The client still sends the raw token it was given;
// hash it the same way (pgcrypto, matching db/schema.ts's requestAccessToken)
// before comparing, or every lookup here would simply never match.
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

  // Same existence check as create-order — don't trust a claimed path.
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

      // Deliberately generic — doesn't reveal whether the order exists at
      // all if the token is wrong, same reasoning as scan-pickup's "invalid
      // code" response (§26).
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
          amount: order.merchandiseSubtotal, // M1 scope: FULL payment only
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

      return { paymentId: newPayment.id };
    });

    return json(result, 201);
  } catch (err) {
    return errorResponse(err, "Unexpected error resubmitting payment.");
  }
});
