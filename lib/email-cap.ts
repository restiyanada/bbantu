const DAILY_CEILING = 90;
const BALANCE_DUE_DAILY_CAP = 80;
const OTHER_DAILY_FLOOR = 10;

export interface EmailCapCounts {
  balanceDueSentToday: number;
  otherSentToday: number;
  balanceDueQueuedAvailable: number;
  otherQueuedAvailable: number;
}

export interface EmailSendBudget {
  balanceDueToSend: number;
  otherToSend: number;
}

export function computeEmailSendBudget(counts: EmailCapCounts): EmailSendBudget {
  const sentToday = counts.balanceDueSentToday + counts.otherSentToday;

  const otherFloorCap = Math.max(0, Math.min(OTHER_DAILY_FLOOR - counts.otherSentToday, DAILY_CEILING - sentToday));
  const otherFloorSend = Math.min(otherFloorCap, counts.otherQueuedAvailable);
  const sentAfterFloor = sentToday + otherFloorSend;

  const balanceDueCap = Math.max(
    0,
    Math.min(BALANCE_DUE_DAILY_CAP - counts.balanceDueSentToday, DAILY_CEILING - sentAfterFloor)
  );
  const balanceDueSend = Math.min(balanceDueCap, counts.balanceDueQueuedAvailable);
  const sentAfterBalanceDue = sentAfterFloor + balanceDueSend;

  const remainingCeiling = Math.max(0, DAILY_CEILING - sentAfterBalanceDue);
  const otherOverflowSend = Math.min(remainingCeiling, counts.otherQueuedAvailable - otherFloorSend);

  return {
    balanceDueToSend: balanceDueSend,
    otherToSend: otherFloorSend + otherOverflowSend,
  };
}
