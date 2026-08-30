// A network call with no timeout can hang a user-facing action indefinitely
// against a slow or unresponsive upstream — exactly what happened when a push
// send blocked prepare-pickup for minutes (see _shared/push.ts). This wraps
// any fetch-based client (or a raw fetch call) so the same class of bug can't
// recur anywhere else: Supabase Auth, Supabase Storage, the JNE shipping
// quote API, Resend.
export function fetchWithTimeout(timeoutMs: number): typeof fetch {
  return (input, init) => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
    return fetch(input, { ...init, signal });
  };
}
