import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAdminAuth } from "@/lib/adminAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Audit log viewer (§20, Milestone 6, item 32) — reads via
 * supabase/functions/list-audit-logs (a direct RLS read isn't possible
 * here without opening up admin_users; see that function's own comment).
 *
 * §18.4's usual "disabled, not hidden" pattern (AdminProductsPage,
 * AdminBatchesPage) doesn't quite fit this page: those disable individual
 * *actions* on a page everyone can still see, but canViewAuditLog gates
 * the whole page's content, not one button on it — so this shows a plain
 * "you don't have permission" message instead, same shape as
 * RequireAdmin's own "not authorized" state.
 */

interface AuditLogRow {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  beforeValue: unknown;
  afterValue: unknown;
  createdAt: string;
  actorName: string | null;
  actorEmail: string | null;
}

export default function AdminAuditLogPage() {
  const { admin } = useAdminAuth();
  const canView = admin?.canViewAuditLog ?? false;

  const [logs, setLogs] = useState<AuditLogRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) return;

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.functions.invoke("list-audit-logs");
      if (cancelled) return;
      if (error || !data) {
        setLoadError("Couldn't load the audit log.");
        return;
      }
      setLogs(data.logs as AuditLogRow[]);
    })();

    return () => {
      cancelled = true;
    };
  }, [canView]);

  return (
    <main className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Admin — Audit log</h1>
      </div>

      {!canView && (
        <p className="text-sm text-muted-foreground">
          This account doesn't have the "View audit log" permission (§18.4). Ask an admin with that permission to
          grant it if you need access.
        </p>
      )}

      {canView && loadError && <p className="text-destructive text-sm">{loadError}</p>}
      {canView && logs === null && !loadError && <p className="text-gray-500 text-sm">Loading…</p>}

      {canView && logs !== null && (
        <Card>
          <CardHeader>
            <CardTitle>Recent activity ({logs.length})</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 pr-4">Actor</th>
                  <th className="py-2 pr-4">Entity</th>
                  <th className="py-2 pr-4">Action</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b last:border-0 align-top">
                    <td className="py-2 pr-4 whitespace-nowrap">{new Date(log.createdAt).toLocaleString()}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">{log.actorName ?? "System / guest"}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {log.entityType} <span className="text-muted-foreground">{log.entityId.slice(0, 8)}</span>
                    </td>
                    <td className="py-2 pr-4">{log.action}</td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-muted-foreground">
                      No audit events yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
