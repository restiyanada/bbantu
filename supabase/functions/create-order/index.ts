/**
 * POST /create-order — guest order creation (PRD §7).
 *
 * Milestone 1: READY_STOCK sales mode, FULL payment, PICKUP fulfilment only.
 * Milestone 2 adds PRE_ORDER: a client sends `batchId` to order from an open
 * batch instead of the general ready-stock catalogue, and can choose
 * `paymentType: "DP"` if that batch allows it (§8.2, §10.1).
 *
 * Milestone 3 adds SHIPPING fulfilment. Ready-stock orders may choose either
 * method freely (no batch to restrict them); pre-order fulfilment is
 * constrained by the batch's `allowedFulfilmentMethods` (§13.1, built in
 * Milestone 2 but unenforced until now). A shipping quote is never trusted
 * from the client — the same server-side-recompute principle as
 * merchandiseSubtotal, extended to shipping cost: this endpoint re-derives
 * the weight from `product_variants.weightGrams` and re-calls
 * getJneRates() itself with the order's actual origin/destination/weight,
 * rather than trusting whatever price the client echoes back from an
 * earlier /shipping-rates call (a quote could theoretically be stale, or a
 * client could simply lie about it).
 *
 * Price is computed here from `product_variants.price`, never trusted from
 * the request body (architecture.md "Security boundary"). For a DP order,
 * the amount actually charged now is 50% of that computed merchandise
 * subtotal (§8.2 — a single global rule, not configurable) *plus the full
 * shipping cost*, not something the client sends. Interpretation flagged,
 * not explicit in the PRD: shipping is a real logistics cost known in full
 * at checkout (unlike merchandise, it has no "wait for stock" reason to be
 * deferred), so it's collected upfront alongside the deposit rather than
 * split across the deposit/balance the way merchandise is. Revisit if this
 * doesn't match how the business actually wants DP + shipping to interact.
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
import { customers, orders, orderItems, payments, productVariants, inventory, batches, batchItems, shippingSettings, shipments } from "../../../db/schema.ts";
import { logAudit } from "../../../lib/audit.ts";
import { getJneRates, computeWeightKg, ShippingProviderError } from "../_shared/shipping.ts";

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
  // Milestone 3. Defaults to PICKUP (Milestone 1/2 clients that don't send
  // this at all keep working unchanged).
  fulfilmentMethod: z.enum(["PICKUP", "SHIPPING"]).default("PICKUP"),
  // Required (validated below, not by zod, so the error can name what's
  // actually missing) when fulfilmentMethod is SHIPPING. serviceCode is
  // whichever JNE service the customer picked from a prior /shipping-rates
  // call — re-validated against a fresh rate lookup below, not trusted.
  // NOT an enum of ["REG","YES"] — real api.co.id responses return many
  // route/weight-specific JNE service codes (e.g. "CTC", "CTCYES",
  // "JTR<130"), not just those two. The enum was a wrong assumption from
  // the provider's example docs; the actual validation is the re-match
  // against a live getJneRates() call further down, not this schema.
  shipping: z
    .object({
      recipientName: z.string().trim().min(1, "Recipient name is required.").regex(NAME_PATTERN, "Name can only contain letters."),
      recipientPhone: z.string().trim().regex(PHONE_PATTERN, "Recipient phone must be 8–15 digits, numbers only."),
      address: z.string().trim().min(1, "Delivery address is required."),
      destinationDistrictCode: z.string().trim().min(1),
      destinationDistrictName: z.string().trim().min(1),
      serviceCode: z.string().trim().min(1),
    })
    .optional(),
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

  if (input.fulfilmentMethod === "SHIPPING" && !input.shipping) {
    return json({ error: "Shipping details are required when shipping is the fulfilment method." }, 400);
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
        if (!batch.allowedFulfilmentMethods.includes(input.fulfilmentMethod)) {
          throw new HttpError(400, `This batch doesn't offer ${input.fulfilmentMethod.toLowerCase()} as a fulfilment method.`);
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

      // ── Milestone 3: shipping cost, re-derived server-side ──
      // `shipmentValues` stays null for PICKUP orders; for SHIPPING it holds
      // everything needed for the shipments insert below, computed from a
      // fresh rate lookup rather than trusted from the request.
      let shippingCostCents = 0;
      let shipmentValues: typeof shipments.$inferInsert | null = null;

      if (input.fulfilmentMethod === "SHIPPING") {
        const shippingInput = input.shipping!; // presence already validated above

        const [origin] = await tx.select().from(shippingSettings).limit(1);
        if (!origin) {
          throw new HttpError(503, "Shipping isn't configured yet — please choose pickup instead.");
        }

        const weightKg = computeWeightKg(
          variants.map((v) => ({ quantity: quantityByVariant.get(v.id)!, weightGrams: v.weightGrams }))
        );

        let rates;
        try {
          rates = await getJneRates({
            originDistrictCode: origin.originDistrictCode,
            destinationDistrictCode: shippingInput.destinationDistrictCode,
            weightKg,
          });
        } catch (err) {
          if (err instanceof ShippingProviderError) {
            throw new HttpError(err.status >= 500 ? 503 : 502, err.message);
          }
          throw err;
        }

        // The customer picked this service code from an earlier
        // /shipping-rates call — re-matched against a *fresh* lookup here,
        // not the price that call returned. If the rate changed or JNE no
        // longer serves this route in the meantime, this fails loudly
        // rather than silently charging a stale/wrong amount.
        const matchedRate = rates.find((r) => r.serviceCode === shippingInput.serviceCode);
        if (!matchedRate) {
          throw new HttpError(
            409,
            "That shipping option is no longer available for this address. Please get a new shipping quote and try again."
          );
        }

        shippingCostCents = Math.round(matchedRate.price * 100);

        shipmentValues = {
          orderId: "", // filled in after the order row exists, below
          courier: "JNE",
          service: shippingInput.serviceCode,
          recipientName: shippingInput.recipientName,
          recipientPhone: shippingInput.recipientPhone,
          address: shippingInput.address,
          destinationDistrictCode: shippingInput.destinationDistrictCode,
          destinationDistrictName: shippingInput.destinationDistrictName,
          weightGrams: weightKg * 1000, // the rounded-up weight actually billed, not the raw sum
          cost: centsToDecimalString(shippingCostCents),
        };
      }

      // §8.2 — DP is a single global rule (50% of merchandise subtotal),
      // computed here from the server-side subtotal, never sent by the
      // client. Shipping (if any) is always collected in full alongside
      // whatever's due now — see the file-level doc comment for why.
      const paymentAmountCents =
        (paymentType === "DP" ? Math.round(subtotalCents * 0.5) : subtotalCents) + shippingCostCents;
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
            fulfilmentMethod: input.fulfilmentMethod,
            // Separate sequence per fulfilment type (db/schema.ts) so order
            // numbers read as #01xxxx (pickup) / #02xxxx (shipping).
            orderNumber:
              input.fulfilmentMethod === "SHIPPING"
                ? sql`nextval('shipping_order_seq')`
                : sql`nextval('pickup_order_seq')`,
            merchandiseSubtotal,
            shippingCost: shipmentValues ? shipmentValues.cost : null,
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

      if (shipmentValues) {
        await tx.insert(shipments).values({ ...shipmentValues, orderId: insertedOrder.id });
      }

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
        after: {
          status: insertedOrder.status,
          merchandiseSubtotal,
          shippingCost: insertedOrder.shippingCost,
          paymentType,
          batchId: insertedOrder.batchId,
        },
      });

      return insertedOrder;
    });

    return json(
      {
        orderId: order.id,
        orderNumber: order.orderNumber,
        accessToken: order.accessToken,
        merchandiseSubtotal: order.merchandiseSubtotal,
        shippingCost: order.shippingCost,
        status: order.status,
      },
      201
    );
  } catch (err) {
    return errorResponse(err, "Unexpected error creating order.");
  }
});
