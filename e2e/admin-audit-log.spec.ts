import { test, expect } from "@playwright/test";
import { loginAsAdmin, stubFunction } from "./fixtures";

function auditLog(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
    entityType: "payment",
    entityId: "pay1",
    action: "PAYMENT_VERIFIED",
    beforeValue: { status: "PENDING" },
    afterValue: { status: "VERIFIED" },
    createdAt: new Date().toISOString(),
    actorName: "Test Admin",
    actorEmail: "admin@example.com",
    ...overrides,
  };
}

test("shows recent activity with the actor who did it", async ({ page }) => {
  await loginAsAdmin(page);
  await stubFunction(page, "list-audit-logs", {
    logs: [auditLog(), auditLog({ id: "a2", action: "ORDER_CANCELLED", actorName: null })],
  });

  await page.goto("/admin/audit-log");
  await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible({ timeout: 10000 });

  await expect(page.getByText("Recent activity (2)")).toBeVisible();
  const table = page.getByRole("table");
  await expect(table.getByText("Test Admin")).toBeVisible();
  // A guest-triggered event has no admin actor — it must still render.
  await expect(table.getByText("System / guest")).toBeVisible();
});

test("searching narrows the audit trail", async ({ page }) => {
  await loginAsAdmin(page);
  await stubFunction(page, "list-audit-logs", {
    logs: [
      auditLog(),
      auditLog({ id: "a2", action: "ORDER_CANCELLED", actorName: "Other Admin", actorEmail: "other@example.com" }),
    ],
  });

  await page.goto("/admin/audit-log");
  await expect(page.getByText("Recent activity (2)")).toBeVisible({ timeout: 10000 });

  await page.getByPlaceholder(/Search by actor/).fill("Other Admin");
  const table = page.getByRole("table");
  await expect(table.getByText("Other Admin")).toBeVisible();
  await expect(table.getByText("Test Admin")).toHaveCount(0);
});

test("an admin without canViewAuditLog is told, not shown an empty table", async ({ page }) => {
  await loginAsAdmin(page, { canViewAuditLog: false });

  let called = false;
  await page.route("**/functions/v1/list-audit-logs", (route) => {
    called = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ logs: [] }) });
  });

  await page.goto("/admin/audit-log");
  await expect(page.getByText(/doesn't have the "View audit log" permission/)).toBeVisible({ timeout: 10000 });
  expect(called).toBe(false);
});

test("a failed load says so rather than reading as an empty log", async ({ page }) => {
  await loginAsAdmin(page);
  await stubFunction(page, "list-audit-logs", { error: "boom" }, 500);

  await page.goto("/admin/audit-log");
  await expect(page.getByText("Couldn't load the audit log.")).toBeVisible({ timeout: 10000 });
});
