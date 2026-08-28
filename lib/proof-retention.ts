/**
 * Payment proof retention — PRD §8/§19: "Uploaded payment proof files are
 * retained for 30 days after the related order reaches a completed
 * fulfilment state (SHIPPED or PICKED_UP), then purged." (Milestone 6.)
 *
 * Pure decision logic, no DB/storage access — same split as
 * lib/batch-allocation.ts. The 30-day clock starts at orders.fulfilledAt
 * (stamped by scan-pickup/record-tracking), not at proof upload time or
 * order-creation time.
 */

export const RETENTION_DAYS = 30;

export interface RetentionCandidate {
  paymentId: string;
  /** Null means the order hasn't reached SHIPPED/PICKED_UP yet — never eligible. */
  fulfilledAt: Date | null;
  /** Already processed by a prior run — never eligible again. */
  proofDeletedAt: Date | null;
}

/**
 * True when this payment's proof file should be deleted: the order is
 * fulfilled, at least RETENTION_DAYS have passed since then, and it hasn't
 * already been deleted.
 */
export function isEligibleForDeletion(
  candidate: RetentionCandidate,
  now: Date,
  retentionDays: number = RETENTION_DAYS
): boolean {
  if (candidate.proofDeletedAt !== null) return false;
  if (candidate.fulfilledAt === null) return false;

  const cutoff = new Date(candidate.fulfilledAt.getTime() + retentionDays * 24 * 60 * 60 * 1000);
  return now >= cutoff;
}

/** Filters a batch of candidates down to the ones eligible for deletion right now. */
export function selectEligibleForDeletion(
  candidates: RetentionCandidate[],
  now: Date,
  retentionDays: number = RETENTION_DAYS
): RetentionCandidate[] {
  return candidates.filter((c) => isEligibleForDeletion(c, now, retentionDays));
}
