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
 * Milestone 4: requires a real Supabase Auth session, but no specific §18.4
 * permission — every admin can see this regardless of individual toggles
 * ("the dashboard itself is read-only for everyone regardless of
 * permissions", §18.4). `requireAdmin(req, null)` means exactly that: any
 * row in admin_users, no particular flag checked.
 */

import { eq, desc, inArray } from "drizzle-orm";
import { db } from "../_shared/db.ts";
import { handleCors } from "../_shared/cors.ts";
import { json, errorResponse } from "../_shared/http.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { getSignedProofUrl } from "../_shared/storage.ts";
import { orders, customers, payments, shipments } from "../../../db/schema.ts";

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  try {
    await requireAdmin(req, null);

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

    // Milestone 3 — only SHIPPING orders have a row here, so this is a
    // straightforward map-by-orderId, same shape as pendingByOrder below.
    const shipmentRows =
      orderIds.length > 0 ? await db.select().from(shipments).where(inArray(shipments.orderId, orderIds)) : [];
    const shipmentByOrder = new Map(shipmentRows.map((s) => [s.orderId, s]));

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
        const shipment = shipmentByOrder.get(row.id) ?? null;

        const pending = pendingByOrder.get(row.id);
        if (!pending) return { ...row, pendingPayment: null, shipment };

        const proofUrl = await getSignedProofUrl(pending.proofFileUrl);
        return { ...row, pendingPayment: { ...pending, proofUrl }, shipment };
      })
    );

    return json({ orders: result });
  } catch (err) {
    return errorResponse(err, "Unexpected error listing orders.");
  }
});
