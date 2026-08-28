/**
 * POST /cleanup-payment-proofs — scheduled worker, §8/§19 (Milestone 6,
 * item 31): "Uploaded payment proof files are retained for 30 days after
 * the related order reaches a completed fulfilment state (SHIPPED or
 * PICKED_UP), then purged."
 *
 * Not customer- or admin-facing — same auth posture as send-queued-emails:
 * deliberately left OUT of supabase/config.toml's verify_jwt = false list,
 * so the platform default (verify_jwt = true) is the real boundary. The
 * only caller is the pg_cron schedule (db/migrations/0006_milestone6_
 * cleanup_schedule.sql), invoked with a genuine service-role JWT.
 *
 * lib/proof-retention.ts has the actual eligibility decision (pure, no DB).
 * This function's job is only: fetch candidates, filter with that pure
 * function, delete the storage object, then stamp proofDeletedAt so a
 * later run doesn't try again — see db/schema.ts's proofDeletedAt comment
 * for why that column exists (proofFileUrl itself stays NOT NULL and
 * unchanged, so it still documents which path used to hold a file).
 *
 * A payment can be resubmitted after rejection (§26), so an order can have
 * more than one payments row with a proof — every one of them tied to a
 * fulfilled order is in scope, not just the latest.
 */

import { eq, and, isNull, isNotNull, lte } from "drizzle-orm";
import { db } from "../_shared/db.ts";
import { handleCors } from "../_shared/cors.ts";
import { json } from "../_shared/http.ts";
import { deleteProofObject } from "../_shared/storage.ts";
import { orders, payments } from "../../../db/schema.ts";
import { isEligibleForDeletion, RETENTION_DAYS } from "../../../lib/proof-retention.ts";

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const now = new Date();
  // Coarse pre-filter in SQL (fulfilled at all, not yet processed, and at
  // least RETENTION_DAYS old by the cheapest possible bound) — the exact
  // per-row cutoff still goes through isEligibleForDeletion below, so this
  // is purely to avoid pulling the entire payments table on every run.
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
