/**
 * Email content — §17.1 (the 4 core emails), §17.2 (body rules).
 *
 * §17.2: "One link only. No order details, no tables, no images in the
 * email body. Subject line contains order ID and action keyword. Footer:
 * business name only." Plain text throughout is a deliberate match to
 * that, not a placeholder for a real HTML template later — the PRD wants
 * these minimal on purpose (§17: "short nudges").
 */

import type { EmailTemplate } from "../../../lib/email-queue.ts";

export interface EmailRenderContext {
  /** Formatted like "#010007" — lib/order-number.ts, same format the order page itself shows. */
  orderNumber: string;
  /** Full URL to the order page. */
  orderLink: string;
  businessName: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
}

export function renderEmail(template: EmailTemplate, ctx: EmailRenderContext): RenderedEmail {
  switch (template) {
    case "ORDER_CONFIRMED":
      return {
        subject: `Order ${ctx.orderNumber} confirmed`,
        text: `Order ${ctx.orderNumber} confirmed. Track here: ${ctx.orderLink}\n\n${ctx.businessName}`,
      };
    case "PAYMENT_REJECTED":
      return {
        subject: `Action required for order ${ctx.orderNumber}`,
        text: `Action required for order ${ctx.orderNumber}: ${ctx.orderLink}\n\n${ctx.businessName}`,
      };
    case "BALANCE_DUE":
      return {
        subject: `Order ${ctx.orderNumber} is ready — balance due`,
        text: `Order ${ctx.orderNumber} is ready. Pay balance: ${ctx.orderLink}\n\n${ctx.businessName}`,
      };
    case "READY_FOR_FULFILMENT":
      return {
        subject: `Order ${ctx.orderNumber} is ready`,
        text: `Order ${ctx.orderNumber} is ready: ${ctx.orderLink}\n\n${ctx.businessName}`,
      };
  }
}
