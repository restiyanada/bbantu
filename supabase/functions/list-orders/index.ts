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

    const shipmentRows =
      orderIds.length > 0 ? await db.select().from(shipments).where(inArray(shipments.orderId, orderIds)) : [];
    const shipmentByOrder = new Map(shipmentRows.map((s) => [s.orderId, s]));

    const allPayments =
      orderIds.length > 0
        ? await db
            .select({
              id: payments.id,
              orderId: payments.orderId,
              status: payments.status,
              amount: payments.amount,
              proofFileUrl: payments.proofFileUrl,
              proofDeletedAt: payments.proofDeletedAt,
              rejectionReason: payments.rejectionReason,
              submittedAt: payments.submittedAt,
            })
            .from(payments)
            .where(inArray(payments.orderId, orderIds))
        : [];

    const latestByOrder = new Map<string, (typeof allPayments)[number]>();
    for (const p of allPayments) {
      const current = latestByOrder.get(p.orderId);
      if (!current || p.submittedAt > current.submittedAt) latestByOrder.set(p.orderId, p);
    }

    const result = await Promise.all(
      rows.map(async (row) => {
        const shipment = shipmentByOrder.get(row.id) ?? null;

        const latest = latestByOrder.get(row.id);
        if (!latest) return { ...row, payment: null, shipment };

        const proofUrl = latest.proofDeletedAt ? null : await getSignedProofUrl(latest.proofFileUrl);
        return { ...row, payment: { ...latest, proofUrl }, shipment };
      })
    );

    return json({ orders: result });
  } catch (err) {
    return errorResponse(err, "Unexpected error listing orders.");
  }
});
