export const RETENTION_DAYS = 30;

export interface RetentionCandidate {
  paymentId: string;
  fulfilledAt: Date | null;
  proofDeletedAt: Date | null;
}

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

export function selectEligibleForDeletion(
  candidates: RetentionCandidate[],
  now: Date,
  retentionDays: number = RETENTION_DAYS
): RetentionCandidate[] {
  return candidates.filter((c) => isEligibleForDeletion(c, now, retentionDays));
}
