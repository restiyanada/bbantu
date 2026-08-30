import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "../_shared/db.ts";
import { handleCors } from "../_shared/cors.ts";
import { HttpError, json, errorResponse } from "../_shared/http.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { pickupTokens, orders, customers, orderItems, productVariants, payments } from "../../../db/schema.ts";
import { transitionOrder } from "../../../lib/orders.ts";

const scanSchema = z.union([
  z.object({
    // Pickup codes are always generated uppercase (prepare-pickup's
    // CODE_ALPHABET); normalizing here means a manually-typed lowercase
    // code still matches the case-sensitive column comparison below,
    // regardless of what the frontend already did to the input.
    token: z
      .string()
      .trim()
      .min(1)
      .transform((v) => v.toUpperCase()),
    confirm: z.boolean().optional().default(false),
  }),
  z.object({
    phone: z.string().trim().min(1),
  }),
]);

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return "*".repeat(digits.length);
  return "*".repeat(digits.length - 4) + digits.slice(-4);
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  let input: z.infer<typeof scanSchema>;
  try {
    input = scanSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return json({ error: "Invalid request.", details: err.issues }, 400);
    }
    return json({ error: "Invalid JSON body." }, 400);
  }

  try {
    const admin = await requireAdmin(req, "canScanConfirmPickup");

    if ("phone" in input) {
      const matches = await db
        .select({
          orderId: orders.id,
          orderNumber: orders.orderNumber,
          pickupToken: pickupTokens.token,
          customerName: customers.name,
        })
        .from(orders)
        .innerJoin(customers, eq(orders.customerId, customers.id))
        .innerJoin(pickupTokens, eq(pickupTokens.orderId, orders.id))
        .where(and(eq(customers.phone, input.phone), eq(orders.status, "READY_FOR_PICKUP")));

      return json({ matches });
    }

    const outcome = await db.transaction(async (tx) => {
      const [pickupToken] = await tx.select().from(pickupTokens).where(eq(pickupTokens.token, input.token));
      if (!pickupToken) {
        throw new HttpError(404, "Invalid pickup code.");
      }

      const [order] = await tx.select().from(orders).where(eq(orders.id, pickupToken.orderId));
      if (!order) {
        throw new HttpError(404, "Invalid pickup code.");
      }

      if (input.confirm) {
        await transitionOrder(tx, {
          orderId: order.id,
          event: "PICKUP_CONFIRMED",
          actorId: admin.id,
          stockAvailable: true,
        });
        await tx.update(orders).set({ fulfilledAt: new Date() }).where(eq(orders.id, order.id));
      }

      const [customer] = await tx.select().from(customers).where(eq(customers.id, order.customerId));
      const items = await tx
        .select({ quantity: orderItems.quantity, variantName: productVariants.name })
        .from(orderItems)
        .innerJoin(productVariants, eq(orderItems.variantId, productVariants.id))
        .where(eq(orderItems.orderId, order.id));
      const [payment] = await tx.select().from(payments).where(eq(payments.orderId, order.id));

      const status = input.confirm ? "PICKED_UP" : order.status;

      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerName: customer?.name ?? null,
        customerPhoneMasked: customer ? maskPhone(customer.phone) : null,
        items: items.map((item) => ({ name: item.variantName, quantity: item.quantity })),
        paymentStatus: payment?.status ?? null,
        orderStatus: status,
        eligibleForPickup: status === "READY_FOR_PICKUP",
        alreadyPickedUp: status === "PICKED_UP",
        confirmed: input.confirm,
      };
    });

    return json(outcome);
  } catch (err) {
    return errorResponse(err, "Unexpected error scanning pickup code.");
  }
});
