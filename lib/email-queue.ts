import { emails } from "../db/schema.ts";

export type EmailTemplate = "ORDER_CONFIRMED" | "PAYMENT_REJECTED" | "BALANCE_DUE" | "READY_FOR_FULFILMENT";
export type EmailPriority = "P0" | "P1";

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

export async function queueEmail(tx: EmailQueueWriter, input: QueueEmailInput): Promise<void> {
  await tx.insert(emails).values({
    orderId: input.orderId,
    toAddress: input.toAddress,
    template: input.template,
    priority: input.priority,
  });
}
