import type { EmailTemplate } from "../../../lib/email-queue.ts";

export interface EmailRenderContext {
  orderNumber: string;
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
