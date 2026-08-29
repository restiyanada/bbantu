export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_REQUESTS = 10;

export function isRateLimited(attemptsInWindow: number, max: number = RATE_LIMIT_MAX_REQUESTS): boolean {
  return attemptsInWindow >= max;
}

export function windowStart(now: Date, windowMs: number = RATE_LIMIT_WINDOW_MS): Date {
  return new Date(now.getTime() - windowMs);
}
