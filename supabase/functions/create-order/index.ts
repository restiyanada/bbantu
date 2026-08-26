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
 * Payment proof (§7.2, v1.3 — required, not optional): the client uploads
 * directly to the private `payment-proofs` Storage bucket first (a plain
 * "save what the user typed" operation, not a business-rule computation —
 * architecture.md's Edge-Function-only rule doesn't apply to the upload
 * itself), then calls this endpoint with the resulting storage path (not a
 * public URL — the bucket has no public read at all, see
 * supabase/storage_setup.sql). Because the order doesn't exist until this
 * call succeeds, we can't verify the upload by checking "does this order own
 * this file" — instead we verify the path actually exists in
 * `storage.objects` (a metadata table Supabase's own docs say is safe to
 * read directly, just not to write to). A client claiming a proof URL with
 * nothing actually uploaded there gets rejected, not silently trusted.
 *
 * Email queuing (PRD §17) is deliberately NOT done here — milestone.md scopes
 * the email queue + worker to Milestone 5 ("nothing else depends on it").
 */

import { inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../_shared/db.ts";
import { handleCors } from "../_shared/cors.ts";
import { HttpError, json, errorResponse, isUniqueViolation, decimalStringToCents, centsToDecimalString } from "../_shared/http.ts";
import { customers, orders, orderItems, payments, productVariants, inventory } from "../../../db/schema.ts";
import { logAudit } from "../../../lib/audit.ts";

// Letters (incl. common accented/Indonesian names), spaces, apostrophes,
// hyphens — matches how the checkout form validates client-side; this is
// the actual enforcement (§3 principle 5 — a browser check alone is never
// sufficient).
const NAME_PATTERN = /^[\p{L}\s'-]+$/u;
// Digits only — customer.phone is used for exact-match lookups (scan-pickup
// phone fallback, §16/§27 recovery), so a consistent digits-only format
// matters more here than accepting formatting punctuation.
const PHONE_PATTERN = /^[0-9]{8,15}$/;

const createOrderSchema = z.object({
  customer: z.object({
    name: z.string().trim().min(1, "Customer name is required.").regex(NAME_PATTERN, "Name can only contain letters."),
    phone: z
      .string()
      .trim()
      .regex(PHONE_PATTERN, "Phone number must be 8–15 digits, numbers only."),
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
  // Storage path within the payment-proofs bucket (e.g.
  // "{submissionToken}/{filename}"), not a public URL — see the doc comment
  // above.
  proofFileUrl: z.string().min(1, "Payment proof is required."),
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

  // Fail fast, before any of the heavier order-creation work, if the client
  // claims a proof path nothing was actually uploaded to.
  const proofRows = await db.execute<{ exists: number }>(
    sql`select 1 as exists from storage.objects where bucket_id = 'payment-proofs' and name = ${input.proofFileUrl} limit 1`
  );
  if (proofRows.length === 0) {
    return json(
      { error: "We couldn't find your uploaded payment proof. Please upload it again before submitting." },
      400
    );
  }

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
            // M1 scope only ever creates PICKUP orders, so always this
            // sequence — shipping orders (Milestone 3) will draw from
            // shipping_order_seq instead. See db/schema.ts.
            orderNumber: sql`nextval('pickup_order_seq')`,
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
        proofFileUrl: input.proofFileUrl,
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
        orderNumber: order.orderNumber,
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
