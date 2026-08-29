import { describe, it, expect } from "vitest";
import { isRateLimited, windowStart, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS } from "./rate-limit";

describe("rate limiting (§16.1/§27 — 10 requests per minute per IP)", () => {
  it("allows requests below the limit", () => {
    expect(isRateLimited(0)).toBe(false);
    expect(isRateLimited(9)).toBe(false);
  });

  it("blocks once prior attempts reach the max", () => {
    expect(isRateLimited(10)).toBe(true);
    expect(isRateLimited(11)).toBe(true);
  });

  it("the 11th attempt in a window is the first one blocked (10 are allowed through)", () => {
    let allowedCount = 0;
    for (let priorAttempts = 0; priorAttempts < 11; priorAttempts++) {
      if (!isRateLimited(priorAttempts)) allowedCount++;
    }
    expect(allowedCount).toBe(RATE_LIMIT_MAX_REQUESTS);
  });

  it("respects a custom max", () => {
    expect(isRateLimited(3, 3)).toBe(true);
    expect(isRateLimited(2, 3)).toBe(false);
  });

  it("windowStart is exactly one window behind now", () => {
    const now = new Date("2026-08-28T12:00:00.000Z");
    expect(windowStart(now).toISOString()).toBe("2026-08-28T11:59:00.000Z");
    expect(RATE_LIMIT_WINDOW_MS).toBe(60_000);
  });
});
