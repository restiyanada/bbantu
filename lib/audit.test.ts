import { describe, it, expect } from "vitest";
import { buildAuditLogEntry, logAudit, type AuditWriter } from "./audit";

describe("buildAuditLogEntry", () => {
  it("maps before/after to beforeValue/afterValue, defaulting to null when omitted", () => {
    expect(
      buildAuditLogEntry({
        actorId: "admin-1",
        entityType: "order",
        entityId: "order-1",
        action: "did a thing",
      })
    ).toEqual({
      actorId: "admin-1",
      entityType: "order",
      entityId: "order-1",
      action: "did a thing",
      beforeValue: null,
      afterValue: null,
    });
  });

  it("carries through actorId: null for system/customer-triggered events", () => {
    const entry = buildAuditLogEntry({
      actorId: null,
      entityType: "order",
      entityId: "order-1",
      action: "customer created order",
      before: { status: "DRAFT" },
      after: { status: "PAYMENT_PENDING" },
    });

    expect(entry.actorId).toBeNull();
    expect(entry.beforeValue).toEqual({ status: "DRAFT" });
    expect(entry.afterValue).toEqual({ status: "PAYMENT_PENDING" });
  });
});

describe("logAudit", () => {
  it("inserts exactly one row built from the input", async () => {
    const inserted: unknown[] = [];
    const tx: AuditWriter = {
      insert: () => ({
        values: async (row) => {
          inserted.push(row);
        },
      }),
    };

    await logAudit(tx, {
      actorId: "admin-1",
      entityType: "payment",
      entityId: "payment-1",
      action: "rejected",
      before: { status: "PENDING" },
      after: { status: "REJECTED" },
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      actorId: "admin-1",
      entityType: "payment",
      entityId: "payment-1",
      action: "rejected",
    });
  });
});
