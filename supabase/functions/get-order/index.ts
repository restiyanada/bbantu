import { eq, desc, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../_shared/db.ts";
import { handleCors } from "../_shared/cors.ts";
import { json, errorResponse } from "../_shared/http.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import {
  orders,
  orderItems,
  payments,
  pickupTokens,
  shipments,
  batches,
  productVariants,
  products,
  productImages,
} from "../../../db/schema.ts";

// The order tracker's lookup used to be a direct-from-browser PostgREST query,
// RLS-gated on a custom `x-order-access-token` header compared via
// current_setting('request.headers'). That mechanism turned out to be
// unreliable on Supabase's hosted REST API: a customer's link could produce
// zero rows even when the token independently proved a byte-for-byte match
// against the stored hash, run directly in Postgres. Every OTHER guest-facing
// action in this codebase (create-order, recover-order-access,
// resubmit-payment, submit-balance-payment) already takes the token in the
// request body and does the comparison here, on the service-role connection —
// this brings the order lookup in line with that, instead of being the one
// path still depending on the header trick.
const requestSchema = z.object({
  accessToken: z.string().trim().min(1, "An order link is required."),
});

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  let input: z.infer<typeof requestSchema>;
  try {
    input = requestSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return json({ error: "Invalid request.", details: err.issues }, 400);
    }
    return json({ error: "Invalid JSON body." }, 400);
  }

  try {
    // A wrong/guessed token is the overwhelmingly common case here (a stale
    // bookmark, a mistyped link), not an attack — tokens are 32 random bytes,
    // guessing is infeasible regardless of this limit. Matches the other
    // guest read endpoints' order of magnitude (shipping-locations is 60/min).
    await enforceRateLimit(req, "get-order", 60);

    const [order] = await db
      .select({
        id: orders.id,
        order_number: orders.orderNumber,
        status: orders.status,
        sales_mode: orders.salesMode,
        payment_type: orders.paymentType,
        merchandise_subtotal: orders.merchandiseSubtotal,
        shipping_cost: orders.shippingCost,
        amount_paid: orders.amountPaid,
        fulfilment_method: orders.fulfilmentMethod,
        created_at: orders.createdAt,
        batch_id: orders.batchId,
      })
      .from(orders)
      .where(sql`${orders.accessToken} = encode(digest(${input.accessToken}, 'sha256'), 'hex')`);

    if (!order) {
      return json({ found: false });
    }

    const [itemRows, paymentRows, pickupRow, shipmentRow, batchRow] = await Promise.all([
      db
        .select({
          quantity: orderItems.quantity,
          unit_price: orderItems.unitPrice,
          product_name: orderItems.productName,
          variant_name: orderItems.variantName,
          image_urls: orderItems.imageUrls,
          variantId: orderItems.variantId,
        })
        .from(orderItems)
        .where(eq(orderItems.orderId, order.id)),
      db
        .select({
          status: payments.status,
          amount: payments.amount,
          submitted_at: payments.submittedAt,
          rejection_reason: payments.rejectionReason,
        })
        .from(payments)
        .where(eq(payments.orderId, order.id))
        .orderBy(desc(payments.submittedAt)),
      db.select({ token: pickupTokens.token }).from(pickupTokens).where(eq(pickupTokens.orderId, order.id)),
      db
        .select({
          courier: shipments.courier,
          service: shipments.service,
          recipient_name: shipments.recipientName,
          address: shipments.address,
          destination_district_name: shipments.destinationDistrictName,
          tracking_number: shipments.trackingNumber,
        })
        .from(shipments)
        .where(eq(shipments.orderId, order.id)),
      order.batch_id
        ? db.select({ name: batches.name }).from(batches).where(eq(batches.id, order.batch_id))
        : Promise.resolve([]),
    ]);

    // The tracker's item card needs the same product_variants -> products ->
    // product_images chain the old direct query joined in one shot. Fetched
    // in two passes here since these Edge Function reads aren't relational.
    const variantIds = [...new Set(itemRows.map((row) => row.variantId))];
    const variantRows =
      variantIds.length > 0
        ? await db
            .select({ id: productVariants.id, name: productVariants.name, productId: productVariants.productId })
            .from(productVariants)
            .where(inArray(productVariants.id, variantIds))
        : [];
    const productIds = [...new Set(variantRows.map((v) => v.productId))];
    const productRows =
      productIds.length > 0
        ? await db
            .select({ id: products.id, name: products.name, description: products.description, imageUrl: products.imageUrl })
            .from(products)
            .where(inArray(products.id, productIds))
        : [];
    const imageRows =
      productIds.length > 0
        ? await db
            .select({ productId: productImages.productId, url: productImages.url, sortOrder: productImages.sortOrder })
            .from(productImages)
            .where(inArray(productImages.productId, productIds))
        : [];

    const variantById = new Map(variantRows.map((v) => [v.id, v]));
    const productById = new Map(productRows.map((p) => [p.id, p]));
    const imagesByProduct = new Map<string, { url: string; sort_order: number }[]>();
    for (const image of imageRows) {
      const list = imagesByProduct.get(image.productId) ?? [];
      list.push({ url: image.url, sort_order: image.sortOrder });
      imagesByProduct.set(image.productId, list);
    }

    const items = itemRows.map((row) => {
      const variant = variantById.get(row.variantId);
      const product = variant ? productById.get(variant.productId) : undefined;
      return {
        quantity: row.quantity,
        unit_price: row.unit_price,
        product_name: row.product_name,
        variant_name: row.variant_name,
        image_urls: row.image_urls,
        product_variants: variant
          ? {
              name: variant.name,
              products: product
                ? {
                    name: product.name,
                    description: product.description,
                    image_url: product.imageUrl,
                    product_images: imagesByProduct.get(product.id) ?? [],
                  }
                : null,
            }
          : null,
      };
    });

    return json({
      found: true,
      order,
      items,
      payments: paymentRows,
      pickupToken: pickupRow[0]?.token ?? null,
      shipment: shipmentRow[0] ?? null,
      batchName: batchRow[0]?.name ?? null,
    });
  } catch (err) {
    return errorResponse(err, "Unexpected error loading the order.");
  }
});
