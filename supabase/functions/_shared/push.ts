import { eq, sql } from "drizzle-orm";
import webpush from "web-push";
import { db } from "./db.ts";
import { orders, pushSubscriptions } from "../../../db/schema.ts";

const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
const vapidSubject = Deno.env.get("VAPID_SUBJECT");
if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
  throw new Error("VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT must be set as Supabase Edge Function secrets.");
}
webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

// Shared with send-queued-emails, which already requires both of these to
// build a clickable order link — reusing them here rather than inventing a
// second pair of secrets for the same job.
const accessTokenEncKey = Deno.env.get("ACCESS_TOKEN_ENC_KEY");
if (!accessTokenEncKey) throw new Error("ACCESS_TOKEN_ENC_KEY must be set as a Supabase Edge Function secret.");
const frontendBaseUrl = Deno.env.get("FRONTEND_BASE_URL");
if (!frontendBaseUrl) throw new Error("FRONTEND_BASE_URL must be set as a Supabase Edge Function secret.");

// A push send that hangs or is merely slow must never make the caller (order
// placement, payment verification, prepare-for-pickup, ...) wait on it —
// nobody who clicked "confirm payment" is asking to also wait on a stranger's
// push service to answer. Two independent guards against that:
//   1. A hard timeout on each individual send (below), since web-push's
//      underlying https.request has no default one and can hang indefinitely
//      against a slow/dead endpoint.
//   2. EdgeRuntime.waitUntil (see runInBackground) so the send happens after
//      the HTTP response is already on its way back, not before it.
const SEND_TIMEOUT_MS = 5000;

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

function runInBackground(work: Promise<unknown>): void {
  if (typeof EdgeRuntime !== "undefined") {
    EdgeRuntime.waitUntil(work);
  }
  // Without EdgeRuntime (e.g. a plain `deno run`, outside Supabase's Edge
  // Functions platform) the promise still executes on its own — there's just
  // no platform guarantee the process stays alive to let it finish.
}

interface PushPayload {
  title: string;
  body: string;
  url: string;
}

type SubscriptionRow = typeof pushSubscriptions.$inferSelect;

// Best-effort by design: a push failing must never turn an otherwise-successful
// payment verification, order placement, etc. into a 500. Every failure mode
// here is swallowed (and logged, so it's still visible in function logs) —
// callers get no signal back and should not expect one.
async function deliver(sub: SubscriptionRow, payload: PushPayload): Promise<void> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.authKey } },
      JSON.stringify(payload),
      { timeout: SEND_TIMEOUT_MS }
    );
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    try {
      if (statusCode === 404 || statusCode === 410) {
        // Gone — the browser revoked or expired this subscription. Stop
        // paying to retry it; the owner can re-subscribe on their next visit.
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
      } else {
        console.error(`push: failed to deliver to subscription ${sub.id}:`, err);
      }
    } catch (cleanupErr) {
      console.error(`push: failed to clean up subscription ${sub.id}:`, cleanupErr);
    }
  }
}

async function buildOrderUrl(orderId: string): Promise<string | null> {
  try {
    const [row] = await db
      .select({
        rawToken: sql<string | null>`pgp_sym_decrypt(decode(${orders.accessTokenEncrypted}, 'base64'), ${accessTokenEncKey})`,
      })
      .from(orders)
      .where(eq(orders.id, orderId));
    return row?.rawToken ? `${frontendBaseUrl}/orders/${row.rawToken}` : null;
  } catch (err) {
    console.error(`push: failed to build order link for ${orderId}:`, err);
    return null;
  }
}

// Fire-and-forget: neither of these returns a Promise, so a caller can't
// accidentally `await` its way back into blocking the response on push
// delivery (the exact bug this file just fixed).
export function notifyAdmins(payload: { title: string; body: string }): void {
  runInBackground(
    (async () => {
      const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.kind, "ADMIN"));
      if (subs.length === 0) return;
      await Promise.all(subs.map((sub) => deliver(sub, { ...payload, url: `${frontendBaseUrl}/dashboard` })));
    })().catch((err) => console.error("push: failed to notify admins:", err))
  );
}

export function notifyOrder(orderId: string, payload: { title: string; body: string }): void {
  runInBackground(
    (async () => {
      const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.orderId, orderId));
      if (subs.length === 0) return;
      const url = (await buildOrderUrl(orderId)) ?? `${frontendBaseUrl}/orders/find`;
      await Promise.all(subs.map((sub) => deliver(sub, { ...payload, url })));
    })().catch((err) => console.error(`push: failed to notify order ${orderId}:`, err))
  );
}
