/**
 * POST /create-order — guest order creation (PRD §7).
 *
 * Milestone 1 scope only: READY_STOCK sales mode, FULL payment, PICKUP
 * fulfilment. Pre-order/batch orders (Milestone 2), DP payment (Milestone 2),
 * and shipping (Milestone 3) all need additional fields this endpoint
 * doesn't accept yet — rejecting them explicitly rather than half-handling.
 *
 * Price is computed here from `product_variants.price`, never trusted from
 * the request body (architecture.md "Security boundary").
 *
 * Payment proof: this endpoint accepts an already-uploaded `proofFileUrl`
 * (client uploads directly to Supabase Storage — a plain "save what the user
 * typed" operation, not a business-rule computation, so architecture.md's
 * Edge-Function-only rule doesn't apply to the upload itself). Storage bucket
 * + RLS policies for that upload aren't wired up yet — that's a currently
 * open gap, not silently treated as done. `proofFileUrl` is optional here so
 * the rest of the flow is testable without it.
 *
 * Email queuing (PRD §17) is deliberately NOT done here — milestone.md scopes
 * the email queue + worker to Milestone 5 ("nothing else depends on it").
 */

import { inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../_shared/db.ts";
import { handleCors } from "../_shared/cors.ts";
import { HttpError, json, errorResponse, isUniqueViolation, decimalStringToCents, centsToDecimalString } from "../_shared/http.ts";
import { customers, orders, orderItems, payments, productVariants, inventory } from "../../../db/schema.ts";
import { logAudit } from "../../../lib/audit.ts";

const createOrderSchema = z.object({
  customer: z.object({
    name: z.string().trim().min(1, "Customer name is required."),
    phone: z.string().trim().min(1, "Phone number is required."),
    email: z.string().trim().email("A valid email is required."),
  }),
  items: z
    .array(
      z.object({
        variantId: z.string().uuid(),
        quantity: z.number().int().positive(),
      })
    )
    .min(1, "At least one item is required."),
  // Client-generated once when the order form loads; the unique constraint on
  // orders.submissionToken is what actually enforces "one order per submit"
  // (§19) — a double-click or retry reuses this value and gets rejected.
  submissionToken: z.string().min(1),
  proofFileUrl: z.string().url().nullable().optional(),
});

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  let input: z.infer<typeof createOrderSchema>;
  try {
    input = createOrderSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return json({ error: "Invalid request.", details: err.issues }, 400);
    }
    return json({ error: "Invalid JSON body." }, 400);
  }

  // Merge duplicate variantIds into one line so quantity checks and the
  // subtotal are computed once per variant, not once per submitted row.
  const quantityByVariant = new Map<string, number>();
  for (const item of input.items) {
    quantityByVariant.set(item.variantId, (quantityByVariant.get(item.variantId) ?? 0) + item.quantity);
  }
  const variantIds = [...quantityByVariant.keys()];

  try {
    const order = await db.transaction(async (tx) => {
      const variants = await tx.select().from(productVariants).where(inArray(productVariants.id, variantIds));
      if (variants.length !== variantIds.length) {
        throw new HttpError(400, "One or more items reference a product variant that doesn't exist.");
      }

      const stockRows = await tx.select().from(inventory).where(inArray(inventory.variantId, variantIds));
      const stockByVariant = new Map(stockRows.map((row) => [row.variantId, row]));

      for (const variantId of variantIds) {
        const stock = stockByVariant.get(variantId);
        const available = (stock?.onHand ?? 0) - (stock?.reserved ?? 0);
        const requested = quantityByVariant.get(variantId)!;
        if (requested > available) {
          const name = variants.find((v) => v.id === variantId)?.name ?? variantId;
          throw new HttpError(409, `Not enough stock available for "${name}".`);
        }
      }

      let subtotalCents = 0;
      const itemRows = variants.map((variant) => {
        const quantity = quantityByVariant.get(variant.id)!;
        subtotalCents += decimalStringToCents(variant.price) * quantity;
        return { variantId: variant.id, quantity, unitPrice: variant.price };
      });
      const merchandiseSubtotal = centsToDecimalString(subtotalCents);

      const [customer] = await tx.insert(customers).values(input.customer).returning();

      const accessToken = crypto.randomUUID();

      let insertedOrder: typeof orders.$inferSelect;
      try {
        [insertedOrder] = await tx
          .insert(orders)
          .values({
            customerId: customer.id,
            salesMode: "READY_STOCK",
            status: "PAYMENT_PENDING",
            paymentType: "FULL",
            fulfilmentMethod: "PICKUP",
            merchandiseSubtotal,
            submissionToken: input.submissionToken,
            accessToken,
          })
          .returning();
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new HttpError(409, "This order was already submitted.");
        }
        throw err;
      }

      await tx.insert(orderItems).values(
        itemRows.map((item) => ({
          orderId: insertedOrder.id,
          variantId: item.variantId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        }))
      );

      await tx.insert(payments).values({
        orderId: insertedOrder.id,
        amount: merchandiseSubtotal,
        proofFileUrl: input.proofFileUrl ?? null,
        status: "PENDING",
      });

      await logAudit(tx, {
        actorId: null,
        entityType: "order",
        entityId: insertedOrder.id,
        action: "customer created order",
        after: { status: insertedOrder.status, merchandiseSubtotal },
      });

      return insertedOrder;
    });

    return json(
      {
        orderId: order.id,
        accessToken: order.accessToken,
        merchandiseSubtotal: order.merchandiseSubtotal,
        status: order.status,
      },
      201
    );
  } catch (err) {
    return errorResponse(err, "Unexpected error creating order.");
  }
});
