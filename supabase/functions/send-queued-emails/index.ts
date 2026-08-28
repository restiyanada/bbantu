/**
 * POST /send-queued-emails — scheduled worker, §24.2.
 *
 * Not an admin action and not customer-facing — see the note in
 * db/schema.ts and the Milestone 5 planning notes on why this has no
 * canSendEmails permission: sending is system-triggered, not a manual
 * admin action. Auth works differently here too: every other function is
 * listed in supabase/config.toml with verify_jwt = false and does its own
 * requireAdmin() check; this one is deliberately left OUT of that list, so
 * the platform's default (verify_jwt = true) is the actual auth boundary —
 * the only real caller is the pg_cron schedule (see
 * db/migrations/0004_milestone5_email_worker_schedule.sql), which invokes
 * this with a genuine service-role JWT.
 *
 * Order of work:
 *   1. Count today's sends so far (UTC calendar day) and what's queued.
 *   2. Work out today's remaining budget for BALANCE_DUE and the
 *      "other" group (ORDER_CONFIRMED + READY_FOR_FULFILMENT) — see
 *      lib/email-cap.ts for the actual cap/floor/overflow logic.
 *   3. Send PAYMENT_REJECTED first (fully uncapped), then BALANCE_DUE
 *      (oldest order — by reservedAt — first), then "other" (oldest
 *      queued first).
 *   4. A single 429 from Resend anywhere stops the rest of this run —
 *      that means the real daily limit is hit, not just our own internal
 *      threshold, so nothing else would succeed either. Whatever's left
 *      just stays QUEUED and gets picked up by a later run (§24.2 "never
 *      dropped" / "defer to next day").
 */

import { eq, and, asc, inArray, gte, sql } from "drizzle-orm";
import { db } from "../_shared/db.ts";
import { handleCors } from "../_shared/cors.ts";
import { json } from "../_shared/http.ts";
import { emails, orders } from "../../../db/schema.ts";
import { computeEmailSendBudget } from "../../../lib/email-cap.ts";
import type { EmailTemplate } from "../../../lib/email-queue.ts";
import { renderEmail } from "../_shared/email-templates.ts";
import { formatOrderNumber } from "../../../lib/order-number.ts";

const resendApiKey = Deno.env.get("RESEND_API_KEY");
if (!resendApiKey) throw new Error("RESEND_API_KEY must be set as a Supabase Edge Function secret.");

const resendFromAddress = Deno.env.get("RESEND_FROM_ADDRESS");
if (!resendFromAddress) throw new Error("RESEND_FROM_ADDRESS must be set as a Supabase Edge Function secret.");

// Milestone 5 (§16.1, §27) — same key create-order used to write this
// column; needed here to read it back. See db/schema.ts's
// accessTokenEncrypted comment for why a hash alone isn't enough.
const accessTokenEncKey = Deno.env.get("ACCESS_TOKEN_ENC_KEY");
if (!accessTokenEncKey) throw new Error("ACCESS_TOKEN_ENC_KEY must be set as a Supabase Edge Function secret.");

const frontendBaseUrl = Deno.env.get("FRONTEND_BASE_URL");
if (!frontendBaseUrl) throw new Error("FRONTEND_BASE_URL must be set as a Supabase Edge Function secret.");

// Cosmetic only (email footer, §17.2) — not worth failing startup over, so
// this one gets a plain fallback instead of throwing like the secrets above.
const businessName = Deno.env.get("BUSINESS_NAME") ?? "Your Store";

const OTHER_TEMPLATES: EmailTemplate[] = ["ORDER_CONFIRMED", "READY_FOR_FULFILMENT"];

interface ResendResult {
  ok: boolean;
  rateLimited: boolean;
  error: string | null;
}

async function sendViaResend(params: { to: string; subject: string; text: string }): Promise<ResendResult> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: resendFromAddress,
      to: params.to,
      subject: params.subject,
      text: params.text,
    }),
  });

  if (res.ok) return { ok: true, rateLimited: false, error: null };
  if (res.status === 429) return { ok: false, rateLimited: true, error: "Resend daily limit reached (429)." };
  const body = await res.text().catch(() => "");
  return { ok: false, rateLimited: false, error: `Resend error ${res.status}: ${body}` };
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  // ── 1. Counts ──
  const sentToday = await db
    .select({ template: emails.template })
    .from(emails)
    .where(and(eq(emails.status, "SENT"), gte(emails.sentAt, todayStart)));

  const balanceDueSentToday = sentToday.filter((e) => e.template === "BALANCE_DUE").length;
  const otherSentToday = sentToday.filter((e) => OTHER_TEMPLATES.includes(e.template as EmailTemplate)).length;

  const queuedBalanceDue = await db
    .select({ id: emails.id })
    .from(emails)
    .where(and(eq(emails.status, "QUEUED"), eq(emails.template, "BALANCE_DUE")));

  const queuedOther = await db
    .select({ id: emails.id })
    .from(emails)
    .where(and(eq(emails.status, "QUEUED"), inArray(emails.template, OTHER_TEMPLATES)));

  // ── 2. Budget ──
  const budget = computeEmailSendBudget({
    balanceDueSentToday,
    otherSentToday,
    balanceDueQueuedAvailable: queuedBalanceDue.length,
    otherQueuedAvailable: queuedOther.length,
  });

  // ── 3. Fetch the actual rows to attempt, in priority + fairness order ──
  const rejectedRows = await db
    .select()
    .from(emails)
    .where(and(eq(emails.status, "QUEUED"), eq(emails.template, "PAYMENT_REJECTED")))
    .orderBy(asc(emails.queuedAt));

  const balanceDueRows =
    budget.balanceDueToSend > 0
      ? (
          await db
            .select({ email: emails })
            .from(emails)
            .innerJoin(orders, eq(emails.orderId, orders.id))
            .where(and(eq(emails.status, "QUEUED"), eq(emails.template, "BALANCE_DUE")))
            .orderBy(asc(orders.reservedAt))
            .limit(budget.balanceDueToSend)
        ).map((r) => r.email)
      : [];

  const otherRows =
    budget.otherToSend > 0
      ? await db
          .select()
          .from(emails)
          .where(and(eq(emails.status, "QUEUED"), inArray(emails.template, OTHER_TEMPLATES)))
          .orderBy(asc(emails.queuedAt))
          .limit(budget.otherToSend)
      : [];

  const toSend = [...rejectedRows, ...balanceDueRows, ...otherRows];

  // ── Batch-fetch link context for every order involved, once. NULL
  // access_token_encrypted (an order created before this column existed,
  // not yet backfilled — see the Milestone 5 setup notes) decrypts to NULL
  // rather than erroring, since pgp_sym_decrypt is a strict SQL function;
  // handled below via the ctx.rawToken null check. ──
  const orderIds = [...new Set(toSend.map((row) => row.orderId).filter((id): id is string => id !== null))];

  const orderContextRows =
    orderIds.length > 0
      ? await db
          .select({
            id: orders.id,
            orderNumber: orders.orderNumber,
            fulfilmentMethod: orders.fulfilmentMethod,
            rawToken: sql<string | null>`pgp_sym_decrypt(decode(${orders.accessTokenEncrypted}, 'base64'), ${accessTokenEncKey})`,
          })
          .from(orders)
          .where(inArray(orders.id, orderIds))
      : [];
  const orderContextById = new Map(orderContextRows.map((row) => [row.id, row]));

  // ── 4. Send ──
  let sentCount = 0;
  let failedCount = 0;
  let stoppedForRateLimit = false;

  for (const row of toSend) {
    if (stoppedForRateLimit) break;

    if (!row.orderId) {
      // Shouldn't happen for these 4 templates — every queueEmail call
      // passes a real orderId — but nothing to link to without one.
      console.error(`send-queued-emails: email ${row.id} has no orderId, marking failed`);
      await db.update(emails).set({ status: "FAILED" }).where(eq(emails.id, row.id));
      failedCount++;
      continue;
    }

    const ctx = orderContextById.get(row.orderId);
    if (!ctx || !ctx.rawToken) {
      // Most likely cause: an order created before Milestone 5's
      // accessTokenEncrypted column existed, and the one-time backfill
      // hasn't been run yet — see the Milestone 5 setup notes.
      console.error(`send-queued-emails: no usable link for order ${row.orderId} (email ${row.id}), marking failed`);
      await db.update(emails).set({ status: "FAILED" }).where(eq(emails.id, row.id));
      failedCount++;
      continue;
    }

    const rendered = renderEmail(row.template as EmailTemplate, {
      orderNumber: formatOrderNumber(ctx.fulfilmentMethod, ctx.orderNumber, row.orderId),
      orderLink: `${frontendBaseUrl}/orders/${ctx.rawToken}`,
      businessName,
    });

    const result = await sendViaResend({ to: row.toAddress, subject: rendered.subject, text: rendered.text });

    if (result.ok) {
      await db.update(emails).set({ status: "SENT", sentAt: new Date() }).where(eq(emails.id, row.id));
      sentCount++;
    } else if (result.rateLimited) {
      stoppedForRateLimit = true;
    } else {
      console.error(`send-queued-emails: failed to send email ${row.id}: ${result.error}`);
      await db.update(emails).set({ status: "FAILED" }).where(eq(emails.id, row.id));
      failedCount++;
    }
  }

  return json({ sent: sentCount, failed: failedCount, stoppedForRateLimit });
});
