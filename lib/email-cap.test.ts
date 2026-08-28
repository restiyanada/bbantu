import { describe, it, expect } from "vitest";
import { computeEmailSendBudget } from "./email-cap";

describe("email send budget (§24.2)", () => {
  it("fresh day, both plentiful: balance-due gets 80, other gets its 10 floor, ceiling hit exactly", () => {
    const budget = computeEmailSendBudget({
      balanceDueSentToday: 0,
      otherSentToday: 0,
      balanceDueQueuedAvailable: 200,
      otherQueuedAvailable: 50,
    });
    expect(budget).toEqual({ balanceDueToSend: 80, otherToSend: 10 });
  });

  it("balance-due has less queued than its cap: leftover ceiling room flows to other", () => {
    const budget = computeEmailSendBudget({
      balanceDueSentToday: 0,
      otherSentToday: 0,
      balanceDueQueuedAvailable: 5,
      otherQueuedAvailable: 50,
    });
    // balance-due only has 5 to send; the other 75 of ceiling headroom
    // goes to "other" instead of sitting unused.
    expect(budget).toEqual({ balanceDueToSend: 5, otherToSend: 50 });
  });

  it("other has less queued than the ceiling would allow: doesn't invent sends that aren't queued", () => {
    const budget = computeEmailSendBudget({
      balanceDueSentToday: 0,
      otherSentToday: 0,
      balanceDueQueuedAvailable: 200,
      otherQueuedAvailable: 3,
    });
    expect(budget).toEqual({ balanceDueToSend: 80, otherToSend: 3 });
  });

  it("both quiet: sends only what's actually queued, no waste, no overreach", () => {
    const budget = computeEmailSendBudget({
      balanceDueSentToday: 0,
      otherSentToday: 0,
      balanceDueQueuedAvailable: 2,
      otherQueuedAvailable: 1,
    });
    expect(budget).toEqual({ balanceDueToSend: 2, otherToSend: 1 });
  });

  it("later run same day: already-sent counts reduce remaining budget correctly", () => {
    const budget = computeEmailSendBudget({
      balanceDueSentToday: 75,
      otherSentToday: 10,
      balanceDueQueuedAvailable: 50,
      otherQueuedAvailable: 50,
    });
    // balance-due: 80 cap - 75 sent = 5 left. other floor already met (10/10),
    // ceiling headroom = 90 - 85 = 5, all of which balance-due can take.
    expect(budget.balanceDueToSend).toBe(5);
    expect(budget.otherToSend).toBe(0);
  });

  it("day already at the 90 ceiling: nothing more sends, even if plenty is queued", () => {
    const budget = computeEmailSendBudget({
      balanceDueSentToday: 80,
      otherSentToday: 10,
      balanceDueQueuedAvailable: 100,
      otherQueuedAvailable: 100,
    });
    expect(budget).toEqual({ balanceDueToSend: 0, otherToSend: 0 });
  });

  it("other's floor is protected even when balance-due alone would have filled the whole ceiling", () => {
    // The exact scenario raised during planning: a big batch receipt makes
    // many orders balance-due on the same day plenty of "ready" orders
    // also need their nudge — other must still get its guaranteed 10.
    const budget = computeEmailSendBudget({
      balanceDueSentToday: 0,
      otherSentToday: 0,
      balanceDueQueuedAvailable: 500,
      otherQueuedAvailable: 20,
    });
    expect(budget.otherToSend).toBeGreaterThanOrEqual(10);
    expect(budget.balanceDueToSend + budget.otherToSend).toBeLessThanOrEqual(90);
  });
});
