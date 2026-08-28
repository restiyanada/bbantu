/**
 * POST /list-audit-logs — audit log viewer for the admin UI (§20,
 * Milestone 6, item 32), gated on canViewAuditLog (§18.4) — the one
 * per-action permission that's actually a *read* gate, unlike the rest of
 * §18.4 ("the dashboard itself is read-only for everyone regardless of
 * permissions") which list-orders relies on via requireAdmin(req, null).
 *
 * Can't be a direct RLS-gated browser read the way AdminBatchesPage reads
 * batches/order_items: audit_logs.actorId references admin_users, and
 * admin_users is deliberately not directly readable by anyone (see its own
 * comment in db/schema.ts) — a service-role Edge Function is the only way
 * to join in the actor's name regardless of how audit_logs' own RLS is
 * configured, so building this as a direct-read table would still need a
 * second exception carved into admin_users just for this one join. Simpler
 * to keep the existing "admin_users is Edge-Function-only" invariant intact
 * and do the read here instead — same reasoning list-orders already
 * established for orders before Milestone 4 added its own RLS.
 */

import { eq, desc } from "drizzle-orm";
import { db } from "../_shared/db.ts";
import { handleCors } from "../_shared/cors.ts";
import { json, errorResponse } from "../_shared/http.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { auditLogs, adminUsers } from "../../../db/schema.ts";

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  try {
    await requireAdmin(req, "canViewAuditLog");

    const rows = await db
      .select({
        id: auditLogs.id,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        action: auditLogs.action,
        beforeValue: auditLogs.beforeValue,
        afterValue: auditLogs.afterValue,
        createdAt: auditLogs.createdAt,
        actorName: adminUsers.name,
        actorEmail: adminUsers.email,
      })
      .from(auditLogs)
      .leftJoin(adminUsers, eq(auditLogs.actorId, adminUsers.id))
      .orderBy(desc(auditLogs.createdAt))
      .limit(200);

    return json({ logs: rows });
  } catch (err) {
    return errorResponse(err, "Unexpected error loading the audit log.");
  }
});
