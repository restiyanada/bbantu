import { auditLogs } from "../db/schema.ts";

export interface AuditWriter {
  insert(table: typeof auditLogs): {
    values(row: NewAuditLogRow): Promise<unknown>;
  };
}

export interface NewAuditLogRow {
  actorId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  beforeValue?: unknown;
  afterValue?: unknown;
}

export interface AuditEventInput {
  actorId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
}

export function buildAuditLogEntry(input: AuditEventInput): NewAuditLogRow {
  return {
    actorId: input.actorId,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    beforeValue: input.before ?? null,
    afterValue: input.after ?? null,
  };
}

export async function logAudit(tx: AuditWriter, input: AuditEventInput): Promise<void> {
  await tx.insert(auditLogs).values(buildAuditLogEntry(input));
}
