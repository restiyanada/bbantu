/**
 * Audit logging — PRD §20 (Audit Log).
 *
 * "Each event should include actor, timestamp, entity type/ID, action and
 * before/after values when relevant." This module is the one place that
 * shape gets assembled and written, so every caller produces consistent rows.
 */

import { auditLogs } from "../db/schema.ts";

/** Minimal shape any drizzle transaction/db needs to support to write an audit row. */
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

/** Pure — assembles the row shape. Kept separate from the write so it's trivially testable. */
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

/** Writes one audit row. Must be called with a transaction, not a standalone db handle. */
export async function logAudit(tx: AuditWriter, input: AuditEventInput): Promise<void> {
  await tx.insert(auditLogs).values(buildAuditLogEntry(input));
}
