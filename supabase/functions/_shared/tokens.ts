/**
 * Order access token generation — Milestone 5 (§16.1, §27).
 *
 * This only generates the *raw* token. Everything derived from it — the
 * one-way hash used for the everyday "is this the right customer" check,
 * and the separately-reversible copy the email worker uses to rebuild a
 * link later — is computed in SQL via pgcrypto, right at the point of
 * insert/compare/read (db/schema.ts's requestAccessToken, and the queries
 * in create-order, resubmit-payment, submit-balance-payment,
 * send-queued-emails). Keeping both derived forms computed by the same
 * pgcrypto functions in one place (the database) means there's no second,
 * hand-written JS implementation that could quietly drift from what the RLS
 * policy actually checks.
 */

const RAW_TOKEN_BYTES = 32; // §16.1/§27: "32+ bytes, base64url encoded"

export function generateAccessToken(): string {
  const bytes = new Uint8Array(RAW_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
