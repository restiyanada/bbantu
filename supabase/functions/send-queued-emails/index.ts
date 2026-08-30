import { eq, and, asc, inArray, gte, sql } from "drizzle-orm";
import { db } from "../_shared/db.ts";
import { handleCors } from "../_shared/cors.ts";
import { json } from "../_shared/http.ts";
import { isAuthorizedCronCaller } from "../_shared/cron-auth.ts";
import { emails, orders } from "../../../db/schema.ts";
import { computeEmailSendBudget } from "../../../lib/email-cap.ts";
import type { EmailTemplate } from "../../../lib/email-queue.ts";
import { renderEmail } from "../_shared/email-templates.ts";
import { formatOrderNumber } from "../../../lib/order-number.ts";

const resendApiKey = Deno.env.get("RESEND_API_KEY");
if (!resendApiKey) throw new Error("RESEND_API_KEY must be set as a Supabase Edge Function secret.");

const resendFromAddress = Deno.env.get("RESEND_FROM_ADDRESS");
if (!resendFromAddress) throw new Error("RESEND_FROM_ADDRESS must be set as a Supabase Edge Function secret.");

const accessTokenEncKey = Deno.env.get("ACCESS_TOKEN_ENC_KEY");
if (!accessTokenEncKey) throw new Error("ACCESS_TOKEN_ENC_KEY must be set as a Supabase Edge Function secret.");

const frontendBaseUrl = Deno.env.get("FRONTEND_BASE_URL");
if (!frontendBaseUrl) throw new Error("FRONTEND_BASE_URL must be set as a Supabase Edge Function secret.");

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
    signal: AbortSignal.timeout(8000),
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

  if (!isAuthorizedCronCaller(req)) {
    return json({ error: "Not authorized." }, 401);
  }

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

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

  const budget = computeEmailSendBudget({
    balanceDueSentToday,
    otherSentToday,
    balanceDueQueuedAvailable: queuedBalanceDue.length,
    otherQueuedAvailable: queuedOther.length,
  });

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

  let sentCount = 0;
  let failedCount = 0;
  let stoppedForRateLimit = false;

  for (const row of toSend) {
    if (stoppedForRateLimit) break;

    if (!row.orderId) {
      const reason = "No order_id on this email row.";
      console.error(`send-queued-emails: email ${row.id} has no orderId, marking failed`);
      await db.update(emails).set({ status: "FAILED", failureReason: reason }).where(eq(emails.id, row.id));
      failedCount++;
      continue;
    }

    const ctx = orderContextById.get(row.orderId);
    if (!ctx || !ctx.rawToken) {
      const reason = "Could not decrypt the order's access token — check ACCESS_TOKEN_ENC_KEY.";
      console.error(`send-queued-emails: no usable link for order ${row.orderId} (email ${row.id}), marking failed`);
      await db.update(emails).set({ status: "FAILED", failureReason: reason }).where(eq(emails.id, row.id));
      failedCount++;
      continue;
    }

    const rendered = renderEmail(row.template as EmailTemplate, {
      orderNumber: formatOrderNumber(ctx.fulfilmentMethod, ctx.orderNumber, row.orderId),
      orderLink: `${frontendBaseUrl}/orders/${ctx.rawToken}`,
      businessName,
    });

    let result: ResendResult;
    try {
      result = await sendViaResend({ to: row.toAddress, subject: rendered.subject, text: rendered.text });
    } catch (err) {
      // A network failure or the timeout above rejects rather than returning
      // a ResendResult — without this, one bad Resend call used to abort the
      // whole batch (every row after it in `toSend` silently never ran)
      // instead of just failing this one email and moving on.
      const reason = err instanceof Error ? err.message : "Unknown error contacting Resend.";
      console.error(`send-queued-emails: failed to send email ${row.id}: ${reason}`);
      await db.update(emails).set({ status: "FAILED", failureReason: reason }).where(eq(emails.id, row.id));
      failedCount++;
      continue;
    }

    if (result.ok) {
      await db.update(emails).set({ status: "SENT", sentAt: new Date() }).where(eq(emails.id, row.id));
      sentCount++;
    } else if (result.rateLimited) {
      stoppedForRateLimit = true;
    } else {
      console.error(`send-queued-emails: failed to send email ${row.id}: ${result.error}`);
      await db.update(emails).set({ status: "FAILED", failureReason: result.error }).where(eq(emails.id, row.id));
      failedCount++;
    }
  }

  return json({ sent: sentCount, failed: failedCount, stoppedForRateLimit });
});
