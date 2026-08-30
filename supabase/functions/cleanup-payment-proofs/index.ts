import { eq, and, isNull, isNotNull, lte } from "drizzle-orm";
import { db } from "../_shared/db.ts";
import { handleCors } from "../_shared/cors.ts";
import { json } from "../_shared/http.ts";
import { isAuthorizedCronCaller } from "../_shared/cron-auth.ts";
import { deleteProofObject } from "../_shared/storage.ts";
import { orders, payments } from "../../../db/schema.ts";
import { isEligibleForDeletion, RETENTION_DAYS } from "../../../lib/proof-retention.ts";

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  if (!isAuthorizedCronCaller(req)) {
    return json({ error: "Not authorized." }, 401);
  }

  const now = new Date();
  const earliestPossibleCutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const candidates = await db
    .select({
      paymentId: payments.id,
      proofFileUrl: payments.proofFileUrl,
      fulfilledAt: orders.fulfilledAt,
    })
    .from(payments)
    .innerJoin(orders, eq(payments.orderId, orders.id))
    .where(and(isNull(payments.proofDeletedAt), isNotNull(orders.fulfilledAt), lte(orders.fulfilledAt, earliestPossibleCutoff)));

  let deletedCount = 0;
  let failedCount = 0;

  for (const candidate of candidates) {
    if (!isEligibleForDeletion({ paymentId: candidate.paymentId, fulfilledAt: candidate.fulfilledAt, proofDeletedAt: null }, now)) {
      continue;
    }

    const result = await deleteProofObject(candidate.proofFileUrl);
    if (!result.ok) {
      console.error(`cleanup-payment-proofs: failed to delete ${candidate.proofFileUrl} (payment ${candidate.paymentId}): ${result.error}`);
      failedCount++;
      continue;
    }

    await db.update(payments).set({ proofDeletedAt: now }).where(eq(payments.id, candidate.paymentId));
    deletedCount++;
  }

  return json({ deleted: deletedCount, failed: failedCount, checked: candidates.length });
});
