/**
 * POST /create-order — guest order creation (PRD §7).
 *
 * Milestone 1: READY_STOCK sales mode, FULL payment, PICKUP fulfilment only.
 * Milestone 2 adds PRE_ORDER: a client sends `batchId` to order from an open
 * batch instead of the general ready-stock catalogue, and can choose
 * `paymentType: "DP"` if that batch allows it (§8.2, §10.1). Fulfilment
 * method is still always forced to PICKUP server-side, for every sales mode
 * — shipping isn't implemented until Milestone 3, so it's rejected here
 * regardless of what a batch's `allowedFulfilmentMethods` nominally permits
 * (that field exists for the batch config screen; it doesn't mean shipping
 * actually works yet).
 *
 * Price is computed here from `product_variants.price`, never trusted from
 * the request body (architecture.md "Security boundary"). For a DP order,
 * the amount actually charged now is 50% of that computed subtotal (§8.2 —
 * a single global rule, not configurable), not something the client sends.
 *
 * Pre-order stock availability is deliberately NOT checked here — §11.2:
 * "pre-order commitments are tracked even before physical stock exists".
 * Ready-stock orders keep the existing check (you can't order what isn't on
 * the shelf).
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

import { inArray, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../_shared/db.ts";
import { handleCors } from "../_shared/cors.ts";
import { HttpError, json, errorResponse, isUniqueViolation, decimalStringToCents, centsToDecimalString } from "../_shared/http.ts";
import { customers, orders, orderItems, payments, productVariants, inventory, batches, batchItems } from "../../../db/schema.ts";
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
  // Milestone 2: present only when ordering from a pre-order batch. Absent
  // (or omitted) means ready stock, exactly like Milestone 1.
  batchId: z.string().uuid().optional(),
  // Only meaningful when batchId is set — ready-stock orders are always
  // FULL (see below, ignored if sent for a non-batch order).
  paymentType: z.enum(["DP", "FULL"]).default("FULL"),
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

  const isPreOrder = input.batchId != null;
  // Ready-stock orders are always FULL, regardless of what a client sends —
  // DP only makes sense when payment is deferred until stock arrives (§8.2),
  // which never applies to stock that's already on hand.
  const paymentType = isPreOrder ? input.paymentType : "FULL";

  try {
    const order = await db.transaction(async (tx) => {
      const variants = await tx.select().from(productVariants).where(inArray(productVariants.id, variantIds));
      if (variants.length !== variantIds.length) {
        throw new HttpError(400, "One or more items reference a product variant that doesn't exist.");
      }

      let batch: typeof batches.$inferSelect | undefined;
      if (isPreOrder) {
        [batch] = await tx.select().from(batches).where(eq(batches.id, input.batchId!));
        if (!batch) {
          throw new HttpError(400, "This batch doesn't exist.");
        }
        if (batch.status !== "OPEN") {
          throw new HttpError(409, "This batch isn't open for orders right now.");
        }
        if (!batch.allowedPaymentTypes.includes(paymentType)) {
          throw new HttpError(400, `This batch doesn't accept ${paymentType} payment.`);
        }

        const items = await tx.select().from(batchItems).where(eq(batchItems.batchId, batch.id));
        const batchVariantIds = new Set(items.map((i) => i.variantId));
        for (const variantId of variantIds) {
          if (!batchVariantIds.has(variantId)) {
            throw new HttpError(400, "One or more items aren't part of this batch.");
          }
        }
      } else {
        // §5.2 Ready stock: physically on hand by definition — must exist
        // right now. Pre-orders skip this check entirely (§11.2).
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
      }

      let subtotalCents = 0;
      const itemRows = variants.map((variant) => {
        const quantity = quantityByVariant.get(variant.id)!;
        subtotalCents += decimalStringToCents(variant.price) * quantity;
        return { variantId: variant.id, quantity, unitPrice: variant.price };
      });
      const merchandiseSubtotal = centsToDecimalString(subtotalCents);

      // §8.2 — DP is a single global rule (50% of order total), computed
      // here from the server-side subtotal, never sent by the client.
      const paymentAmountCents = paymentType === "DP" ? Math.round(subtotalCents * 0.5) : subtotalCents;
      const paymentAmount = centsToDecimalString(paymentAmountCents);

      const [customer] = await tx.insert(customers).values(input.customer).returning();

      const accessToken = crypto.randomUUID();

      let insertedOrder: typeof orders.$inferSelect;
      try {
        [insertedOrder] = await tx
          .insert(orders)
          .values({
            customerId: customer.id,
            salesMode: isPreOrder ? "PRE_ORDER" : "READY_STOCK",
            batchId: isPreOrder ? input.batchId : null,
            status: "PAYMENT_PENDING",
            paymentType,
            // Forced regardless of sales mode/batch config — shipping isn't
            // built yet (Milestone 3). See file-level doc comment.
            fulfilmentMethod: "PICKUP",
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
        amount: paymentAmount,
        proofFileUrl: input.proofFileUrl,
        status: "PENDING",
      });

      await logAudit(tx, {
        actorId: null,
        entityType: "order",
        entityId: insertedOrder.id,
        action: "customer created order",
        after: { status: insertedOrder.status, merchandiseSubtotal, paymentType, batchId: insertedOrder.batchId },
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
