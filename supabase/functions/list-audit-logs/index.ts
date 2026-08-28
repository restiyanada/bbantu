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
