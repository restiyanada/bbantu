// A plain setTimeout-based "give up waiting" race (what AdminLoginPage used
// at first) is not reliable on mobile: browsers throttle or pause JS timers
// in a backgrounded/locked tab, so the UI can still be stuck long after the
// timeout was supposed to fire. Aborting the actual fetch is more robust —
// it's tied to the request's own lifecycle rather than a page-level timer.
export function fetchWithTimeout(timeoutMs: number): typeof fetch {
  return (input, init) => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
    return fetch(input, { ...init, signal });
  };
}
