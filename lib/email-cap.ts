/**
 * Daily email send budget — PRD §24.2.
 *
 * Three rules, from the PRD plus one refinement agreed during Milestone 5
 * planning:
 *   - PAYMENT_REJECTED is uncapped entirely — not handled by this file at
 *     all. The worker just attempts every queued one, stopping only if
 *     Resend itself returns 429 (§24.2: "never dropped").
 *   - BALANCE_DUE gets up to 80/day (§24.2's "balance-due batching" rule).
 *   - ORDER_CONFIRMED + READY_FOR_FULFILMENT ("other" below) are
 *     guaranteed at least 10/day *before* BALANCE_DUE touches anything —
 *     otherwise a big batch-due event could crowd them out entirely on a
 *     busy day, which is exactly the scenario flagged during planning.
 *     Whatever ceiling headroom BALANCE_DUE doesn't end up using (either
 *     because its own 80 cap, or simply because fewer than that are
 *     actually queued) flows back to "other" instead of going to waste.
 *   - Both stay under a combined 90/day ceiling (§24.2's internal safety
 *     threshold, deliberately below Resend's real 100/day hard limit).
 *
 * This only computes *how many* of each to attempt this run — it doesn't
 * send anything or know about specific email rows. Kept pure so the
 * cascading-leftover logic (the trickiest part) is directly testable
 * without a database or a mocked Resend call.
 */

const DAILY_CEILING = 90;
const BALANCE_DUE_DAILY_CAP = 80;
const OTHER_DAILY_FLOOR = 10;

export interface EmailCapCounts {
  /** BALANCE_DUE emails already sent today (any priority — but this is always P0). */
  balanceDueSentToday: number;
  /** ORDER_CONFIRMED + READY_FOR_FULFILMENT emails already sent today, combined. */
  otherSentToday: number;
  /** BALANCE_DUE rows currently QUEUED and eligible to send. */
  balanceDueQueuedAvailable: number;
  /** ORDER_CONFIRMED + READY_FOR_FULFILMENT rows currently QUEUED and eligible to send. */
  otherQueuedAvailable: number;
}

export interface EmailSendBudget {
  balanceDueToSend: number;
  otherToSend: number;
}

export function computeEmailSendBudget(counts: EmailCapCounts): EmailSendBudget {
  const sentToday = counts.balanceDueSentToday + counts.otherSentToday;

  // 1. Guarantee "other" its floor first, before balance-due gets anything —
  //    bounded by what's actually queued and by ceiling headroom.
  const otherFloorCap = Math.max(0, Math.min(OTHER_DAILY_FLOOR - counts.otherSentToday, DAILY_CEILING - sentToday));
  const otherFloorSend = Math.min(otherFloorCap, counts.otherQueuedAvailable);
  const sentAfterFloor = sentToday + otherFloorSend;

  // 2. balance-due gets up to its own cap, bounded by remaining ceiling
  //    headroom and by what's actually queued.
  const balanceDueCap = Math.max(
    0,
    Math.min(BALANCE_DUE_DAILY_CAP - counts.balanceDueSentToday, DAILY_CEILING - sentAfterFloor)
  );
  const balanceDueSend = Math.min(balanceDueCap, counts.balanceDueQueuedAvailable);
  const sentAfterBalanceDue = sentAfterFloor + balanceDueSend;

  // 3. Any ceiling headroom balance-due didn't use (own cap, or simply
  //    nothing left queued) goes to "other" — bounded by what's queued
  //    beyond what the floor above already claimed.
  const remainingCeiling = Math.max(0, DAILY_CEILING - sentAfterBalanceDue);
  const otherOverflowSend = Math.min(remainingCeiling, counts.otherQueuedAvailable - otherFloorSend);

  return {
    balanceDueToSend: balanceDueSend,
    otherToSend: otherFloorSend + otherOverflowSend,
  };
}
