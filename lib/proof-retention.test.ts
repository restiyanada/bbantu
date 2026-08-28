import { describe, it, expect } from "vitest";
import { isEligibleForDeletion, selectEligibleForDeletion, RETENTION_DAYS } from "./proof-retention";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-28T00:00:00.000Z");

describe("payment proof retention (§8/§19 — 30 days after fulfilment)", () => {
  it("not eligible when the order was never fulfilled", () => {
    expect(isEligibleForDeletion({ paymentId: "p1", fulfilledAt: null, proofDeletedAt: null }, NOW)).toBe(false);
  });

  it("not eligible before 30 days have passed", () => {
    const fulfilledAt = new Date(NOW.getTime() - 29 * DAY_MS);
    expect(isEligibleForDeletion({ paymentId: "p1", fulfilledAt, proofDeletedAt: null }, NOW)).toBe(false);
  });

  it("eligible exactly at 30 days", () => {
    const fulfilledAt = new Date(NOW.getTime() - RETENTION_DAYS * DAY_MS);
    expect(isEligibleForDeletion({ paymentId: "p1", fulfilledAt, proofDeletedAt: null }, NOW)).toBe(true);
  });

  it("eligible well past 30 days", () => {
    const fulfilledAt = new Date(NOW.getTime() - 90 * DAY_MS);
    expect(isEligibleForDeletion({ paymentId: "p1", fulfilledAt, proofDeletedAt: null }, NOW)).toBe(true);
  });

  it("not eligible if already deleted, no matter how old", () => {
    const fulfilledAt = new Date(NOW.getTime() - 90 * DAY_MS);
    const proofDeletedAt = new Date(NOW.getTime() - 1 * DAY_MS);
    expect(isEligibleForDeletion({ paymentId: "p1", fulfilledAt, proofDeletedAt }, NOW)).toBe(false);
  });

  it("selectEligibleForDeletion filters a mixed batch correctly", () => {
    const candidates = [
      { paymentId: "not-fulfilled", fulfilledAt: null, proofDeletedAt: null },
      { paymentId: "too-recent", fulfilledAt: new Date(NOW.getTime() - 5 * DAY_MS), proofDeletedAt: null },
      { paymentId: "eligible", fulfilledAt: new Date(NOW.getTime() - 45 * DAY_MS), proofDeletedAt: null },
      {
        paymentId: "already-deleted",
        fulfilledAt: new Date(NOW.getTime() - 45 * DAY_MS),
        proofDeletedAt: new Date(NOW.getTime() - 1 * DAY_MS),
      },
    ];
    const result = selectEligibleForDeletion(candidates, NOW);
    expect(result.map((c) => c.paymentId)).toEqual(["eligible"]);
  });
});
