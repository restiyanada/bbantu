import { inArray, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../_shared/db.ts";
import { handleCors } from "../_shared/cors.ts";
import { HttpError, json, errorResponse, isUniqueViolation, decimalStringToCents, centsToDecimalString } from "../_shared/http.ts";
import { customers, orders, orderItems, payments, productVariants, products, productImages, inventory, batches, batchItems, shippingSettings, shipments } from "../../../db/schema.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { logAudit } from "../../../lib/audit.ts";
import { getJneRates, computeWeightKg, ShippingProviderError } from "../_shared/shipping.ts";
import { generateAccessToken } from "../_shared/tokens.ts";

const accessTokenEncKey = Deno.env.get("ACCESS_TOKEN_ENC_KEY");
if (!accessTokenEncKey) {
  throw new Error("ACCESS_TOKEN_ENC_KEY must be set as a Supabase Edge Function secret.");
}

const NAME_PATTERN = /^[\p{L}\s'-]+$/u;
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
  submissionToken: z.string().min(1),
  proofFileUrl: z.string().min(1, "Payment proof is required."),
  batchId: z.string().uuid().optional(),
  paymentType: z.enum(["DP", "FULL"]).default("FULL"),
  fulfilmentMethod: z.enum(["PICKUP", "SHIPPING"]).default("PICKUP"),
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

  // Before the storage lookup and the order transaction below, so an abusive
  // caller can't make us do that work repeatedly (§16.1/§19).
  try {
    await enforceRateLimit(req, "create-order");
  } catch (err) {
    return errorResponse(err, "Unexpected error checking the rate limit.");
  }

  const quantityByVariant = new Map<string, number>();
  for (const item of input.items) {
    quantityByVariant.set(item.variantId, (quantityByVariant.get(item.variantId) ?? 0) + item.quantity);
  }
  const variantIds = [...quantityByVariant.keys()];

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

      // Capture what the customer is buying, so a later product edit can't
      // rewrite the record of this order. The price is already captured the
      // same way; the name and photos join it.
      const productIds = [...new Set(variants.map((v) => v.productId))];
      const productRows = await tx.select().from(products).where(inArray(products.id, productIds));
      const productById = new Map(productRows.map((row) => [row.id, row]));

      const imageRows = await tx
        .select()
        .from(productImages)
        .where(inArray(productImages.productId, productIds))
        .orderBy(productImages.sortOrder);
      const imagesByProduct = new Map<string, string[]>();
      for (const image of imageRows) {
        const list = imagesByProduct.get(image.productId) ?? [];
        list.push(image.url);
        imagesByProduct.set(image.productId, list);
      }

      let subtotalCents = 0;
      const itemRows = variants.map((variant) => {
        const quantity = quantityByVariant.get(variant.id)!;
        subtotalCents += decimalStringToCents(variant.price) * quantity;
        const product = productById.get(variant.productId);
        // Fall back to the cover column for a product with no product_images rows.
        const coverOnly = product?.imageUrl ? [product.imageUrl] : [];
        return {
          variantId: variant.id,
          quantity,
          unitPrice: variant.price,
          productName: product?.name ?? null,
          variantName: variant.name,
          imageUrls: imagesByProduct.get(variant.productId) ?? coverOnly,
        };
      });
      const merchandiseSubtotal = centsToDecimalString(subtotalCents);

      let shippingCostCents = 0;
      let shipmentValues: typeof shipments.$inferInsert | null = null;

      if (input.fulfilmentMethod === "SHIPPING") {
        const shippingInput = input.shipping!;

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

        const matchedRate = rates.find((r) => r.serviceCode === shippingInput.serviceCode);
        if (!matchedRate) {
          throw new HttpError(
            409,
            "That shipping option is no longer available for this address. Please get a new shipping quote and try again."
          );
        }

        shippingCostCents = Math.round(matchedRate.price * 100);

        shipmentValues = {
          orderId: "",
          courier: "JNE",
          service: shippingInput.serviceCode,
          recipientName: shippingInput.recipientName,
          recipientPhone: shippingInput.recipientPhone,
          address: shippingInput.address,
          destinationDistrictCode: shippingInput.destinationDistrictCode,
          destinationDistrictName: shippingInput.destinationDistrictName,
          weightGrams: weightKg * 1000,
          cost: centsToDecimalString(shippingCostCents),
        };
      }

      const paymentAmountCents =
        (paymentType === "DP" ? Math.round(subtotalCents * 0.5) : subtotalCents) + shippingCostCents;
      const paymentAmount = centsToDecimalString(paymentAmountCents);

      const [customer] = await tx.insert(customers).values(input.customer).returning();

      const rawAccessToken = generateAccessToken();

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
            orderNumber:
              input.fulfilmentMethod === "SHIPPING"
                ? sql`nextval('shipping_order_seq')`
                : sql`nextval('pickup_order_seq')`,
            merchandiseSubtotal,
            shippingCost: shipmentValues ? shipmentValues.cost : null,
            submissionToken: input.submissionToken,
            accessToken: sql`encode(digest(${rawAccessToken}, 'sha256'), 'hex')`,
            accessTokenEncrypted: sql`encode(pgp_sym_encrypt(${rawAccessToken}, ${accessTokenEncKey}), 'base64')`,
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
          productName: item.productName,
          variantName: item.variantName,
          imageUrls: item.imageUrls,
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

      return { order: insertedOrder, rawAccessToken };
    });

    return json(
      {
        orderId: order.order.id,
        orderNumber: order.order.orderNumber,
        accessToken: order.rawAccessToken,
        merchandiseSubtotal: order.order.merchandiseSubtotal,
        shippingCost: order.order.shippingCost,
        status: order.order.status,
      },
      201
    );
  } catch (err) {
    return errorResponse(err, "Unexpected error creating order.");
  }
});
