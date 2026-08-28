import { useEffect, useMemo, useState } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { supabase } from "@/lib/supabaseClient";
import { useAdminAuth } from "@/lib/adminAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableFilter } from "@/components/data-table";
import AdminLayout from "@/components/AdminLayout";

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

const columnHelper = createColumnHelper<AuditLogRow>();

export default function AdminAuditLogPage() {
  const { admin } = useAdminAuth();
  const canView = admin?.canViewAuditLog ?? false;

  const [logs, setLogs] = useState<AuditLogRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState("");

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

  const columns = [
    columnHelper.accessor("createdAt", {
      header: "When",
      cell: (info) => <span className="whitespace-nowrap">{new Date(info.getValue()).toLocaleString()}</span>,
    }),
    columnHelper.accessor("actorName", {
      header: "Actor",
      cell: ({ row }) => <span className="whitespace-nowrap">{row.original.actorName ?? "System / guest"}</span>,
    }),
    columnHelper.display({
      id: "entity",
      header: "Entity",
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          {row.original.entityType} <span className="text-muted-foreground">{row.original.entityId.slice(0, 8)}</span>
        </span>
      ),
    }),
    columnHelper.accessor("action", { header: "Action" }),
  ];

  const actionOptions = useMemo(
    () =>
      Array.from(new Set((logs ?? []).map((l) => l.action)))
        .sort()
        .map((a) => ({ label: a, value: a })),
    [logs]
  );

  const filters: DataTableFilter<AuditLogRow>[] = [
    {
      label: "All actions",
      value: actionFilter,
      onChange: setActionFilter,
      options: actionOptions,
      predicate: (row, value) => row.action === value,
    },
  ];

  return (
    <AdminLayout>
      <main className="p-4 sm:p-8 space-y-6">
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
            <CardContent>
              <DataTable
                columns={columns}
                data={logs}
                emptyMessage="No audit events yet."
                searchPlaceholder="Search by actor, entity, or action…"
                searchableText={(l) =>
                  `${l.actorName ?? ""} ${l.actorEmail ?? ""} ${l.entityType} ${l.entityId} ${l.action}`
                }
                filters={filters}
              />
            </CardContent>
          </Card>
        )}
      </main>
    </AdminLayout>
  );
}
