/**
 * Email queuing — PRD §17 (4 core emails), §24 (queue worker).
 *
 * Queuing an email is just an insert into `emails`, done inside the same
 * transaction as whatever order event caused it — same reasoning as
 * lib/audit.ts: if the transaction rolls back, the email never should have
 * been queued either. Actually *sending* is a completely separate concern
 * (supabase/functions/send-queued-emails), on purpose — §24.3 "email
 * failure must never block order state". Queuing can never fail the way
 * sending can (no network call, no third-party API), so putting it in the
 * same transaction as the state change costs nothing and guarantees the two
 * never disagree about what happened.
 */

import { emails } from "../db/schema.ts";

export type EmailTemplate = "ORDER_CONFIRMED" | "PAYMENT_REJECTED" | "BALANCE_DUE" | "READY_FOR_FULFILMENT";
export type EmailPriority = "P0" | "P1";

/** Minimal shape any drizzle transaction/db needs to support to queue an email. */
export interface EmailQueueWriter {
  insert(table: typeof emails): {
    values(row: NewEmailRow): Promise<unknown>;
  };
}

export interface NewEmailRow {
  orderId: string;
  toAddress: string;
  template: EmailTemplate;
  priority: EmailPriority;
}

export interface QueueEmailInput {
  orderId: string;
  toAddress: string;
  template: EmailTemplate;
  priority: EmailPriority;
}

/** Writes one queued-email row. Must be called with a transaction, not a standalone db handle. */
export async function queueEmail(tx: EmailQueueWriter, input: QueueEmailInput): Promise<void> {
  await tx.insert(emails).values({
    orderId: input.orderId,
    toAddress: input.toAddress,
    template: input.template,
    priority: input.priority,
  });
}
