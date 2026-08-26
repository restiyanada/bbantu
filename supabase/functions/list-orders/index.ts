/**
 * POST /list-orders — returns recent orders for the admin action screen.
 *
 * The admin screen can't just read `orders` directly via supabase-js: the
 * RLS policy on that table (db/schema.ts) deliberately only allows a guest
 * to read *their own* order, matched by access token header (§16, §27) —
 * there's no "staff" role yet for RLS to grant broader access to (that's
 * Milestone 4). So for now, this is a small Edge Function using the service
 * role connection (bypasses RLS) to return what the admin screen needs.
 *
 * ⚠️ NOT SECURE YET — same caveat as verify-payment/prepare-pickup/
 * scan-pickup. No admin auth check. Anyone with the anon key can currently
 * call this and see every order, customer name, and phone number. Do not
 * expose this function's URL outside trusted testing until Milestone 4 adds
 * real staff auth + the §18.4 canVerifyPayments/canScanConfirmPickup checks
 * (which should gate this read too, not just the write actions).
 */

import { eq, desc, inArray } from "drizzle-orm";
import { db } from "../_shared/db.ts";
import { handleCors } from "../_shared/cors.ts";
import { json, errorResponse } from "../_shared/http.ts";
import { getSignedProofUrl } from "../_shared/storage.ts";
import { orders, customers, payments } from "../../../db/schema.ts";

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  try {
    const rows = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        salesMode: orders.salesMode,
        paymentType: orders.paymentType,
        fulfilmentMethod: orders.fulfilmentMethod,
        merchandiseSubtotal: orders.merchandiseSubtotal,
        amountPaid: orders.amountPaid,
        createdAt: orders.createdAt,
        customerName: customers.name,
        customerPhone: customers.phone,
      })
      .from(orders)
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .orderBy(desc(orders.createdAt))
      .limit(100);

    const orderIds = rows.map((r) => r.id);
    const pendingPayments =
      orderIds.length > 0
        ? await db
            .select({
              id: payments.id,
              orderId: payments.orderId,
              status: payments.status,
              amount: payments.amount,
              proofFileUrl: payments.proofFileUrl,
            })
            .from(payments)
            .where(inArray(payments.orderId, orderIds))
        : [];

    // Confirmed still holds now that resubmit-payment exists: that endpoint
    // only allows a new payment row when the *latest* one is REJECTED, so a
    // second resubmission attempt while one is already PENDING gets a 409
    // there rather than ever producing two PENDING rows for the same order.
    const pendingByOrder = new Map(
      pendingPayments.filter((p) => p.status === "PENDING").map((p) => [p.orderId, p])
    );

    const result = await Promise.all(
      rows.map(async (row) => {
        const pending = pendingByOrder.get(row.id);
        if (!pending) return { ...row, pendingPayment: null };

        const proofUrl = await getSignedProofUrl(pending.proofFileUrl);
        return { ...row, pendingPayment: { ...pending, proofUrl } };
      })
    );

    return json({ orders: result });
  } catch (err) {
    return errorResponse(err, "Unexpected error listing orders.");
  }
});
