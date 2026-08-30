import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../_shared/db.ts";
import { handleCors } from "../_shared/cors.ts";
import { HttpError, json, errorResponse, isUniqueViolation } from "../_shared/http.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { orders, pickupTokens, customers } from "../../../db/schema.ts";
import { transitionOrder } from "../../../lib/orders.ts";
import { queueEmail } from "../../../lib/email-queue.ts";
import { notifyOrder } from "../_shared/push.ts";

const prepareSchema = z.object({ orderId: z.string().uuid() });

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generatePickupCode(length = 6): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  let input: z.infer<typeof prepareSchema>;
  try {
    input = prepareSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return json({ error: "Invalid request.", details: err.issues }, 400);
    }
    return json({ error: "Invalid JSON body." }, 400);
  }

  try {
    const [orderRow] = await db.select({ fulfilmentMethod: orders.fulfilmentMethod }).from(orders).where(eq(orders.id, input.orderId));
    if (!orderRow) {
      throw new HttpError(404, "Order not found.");
    }

    const admin = await requireAdmin(req, orderRow.fulfilmentMethod === "SHIPPING" ? "canManageShipping" : "canScanConfirmPickup");

    const result = await db.transaction(async (tx) => {
      const { to } = await transitionOrder(tx, {
        orderId: input.orderId,
        event: "PREPARE_FOR_FULFILMENT",
        actorId: admin.id,
        stockAvailable: true,
      });

      const [order] = await tx
        .select({ customerId: orders.customerId })
        .from(orders)
        .where(eq(orders.id, input.orderId));
      if (order) {
        const [customer] = await tx.select({ email: customers.email }).from(customers).where(eq(customers.id, order.customerId));
        if (customer) {
          await queueEmail(tx, {
            orderId: input.orderId,
            toAddress: customer.email,
            template: "READY_FOR_FULFILMENT",
            priority: "P1",
          });
        }
      }

      if (to !== "READY_FOR_PICKUP") {
        return { status: to, pickupToken: null as string | null };
      }

      let token = "";
      for (let attempt = 0; attempt < 5; attempt++) {
        token = generatePickupCode();
        try {
          await tx.insert(pickupTokens).values({ orderId: input.orderId, token });
          break;
        } catch (err) {
          if (isUniqueViolation(err) && attempt < 4) continue;
          throw err;
        }
      }

      return { status: to, pickupToken: token };
    });

    notifyOrder(input.orderId, {
      title: orderRow.fulfilmentMethod === "SHIPPING" ? "Ready to ship" : "Ready for pickup",
      body:
        orderRow.fulfilmentMethod === "SHIPPING"
          ? "Your order is being prepared for shipment."
          : "Your order is ready for pickup at the booth.",
    });

    return json({ orderId: input.orderId, ...result });
  } catch (err) {
    return errorResponse(err, "Unexpected error preparing order for pickup.");
  }
});
