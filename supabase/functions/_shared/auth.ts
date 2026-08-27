/**
 * Admin authentication + per-action permission checks (§18.4) — Milestone 4.
 *
 * Staff identity is a real Supabase Auth session (magic link), sent by the
 * browser as a standard `Authorization: Bearer <jwt>` header — supabase-js
 * attaches this automatically on every `functions.invoke()` call once
 * `supabase.auth.signInWithOtp()` has established a session, no extra work
 * needed on the frontend beyond being logged in.
 *
 * `admin_users` is matched by **email**, not by making its `id` equal the
 * Supabase Auth user's id. Every existing FK (payments.verifiedBy,
 * inventoryTransactions.createdBy, auditLogs.actorId) already points at
 * admin_users rows seeded before real auth existed (Milestone 1's
 * HARDCODED_ADMIN_ID) — matching by email instead of id means none of that
 * historical data needs to move.
 *
 * `supabase.auth.getUser(jwt)` (not manual JWT verification) is used to
 * validate the token — it calls Supabase Auth's own server to confirm the
 * JWT is real, unexpired, and not revoked, which is simpler and more
 * correct than re-implementing signature verification here.
 */

import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { db } from "./db.ts";
import { HttpError } from "./http.ts";
import { adminUsers } from "../../../db/schema.ts";

export type AdminPermission =
  | "canVerifyPayments"
  | "canScanConfirmPickup"
  | "canManageProductsBatches"
  | "canAdjustInventory"
  | "canManageShipping"
  | "canViewAuditLog";

export interface AuthenticatedAdmin {
  id: string;
  name: string;
  email: string;
  canVerifyPayments: boolean;
  canScanConfirmPickup: boolean;
  canManageProductsBatches: boolean;
  canAdjustInventory: boolean;
  canManageShipping: boolean;
  canViewAuditLog: boolean;
}

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
if (!supabaseUrl || !anonKey) {
  throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be available.");
}
// Anon key here, not service role — this client's only job is to ask
// Supabase Auth "is this JWT a real, current session", the same check the
// platform gateway would do. It never touches any table.
const authClient = createClient(supabaseUrl, anonKey);

function bearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Validates the caller's Supabase Auth session and, when `permission` is
 * given, checks the matching `admin_users` boolean flag.
 *
 * `permission: null` means "any logged-in admin, no specific permission
 * required" — for read endpoints the whole dashboard is allowed to see
 * regardless of individual toggles (§18.4: "the dashboard itself is
 * read-only for everyone regardless of permissions").
 *
 * Throws `HttpError(401)` if there's no valid session, or `HttpError(403)`
 * if the session belongs to someone not in `admin_users`, or lacking the
 * specific permission requested.
 */
export async function requireAdmin(req: Request, permission: AdminPermission | null): Promise<AuthenticatedAdmin> {
  const token = bearerToken(req);
  if (!token) {
    throw new HttpError(401, "Not authenticated. Please log in.");
  }

  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user?.email) {
    throw new HttpError(401, "Your session has expired. Please log in again.");
  }

  const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.email, data.user.email));
  if (!admin) {
    throw new HttpError(403, "This account is not set up as an admin.");
  }

  if (permission !== null && !admin[permission]) {
    throw new HttpError(403, `You don't have permission to do this (${permission}).`);
  }

  return {
    id: admin.id,
    name: admin.name,
    email: admin.email,
    canVerifyPayments: admin.canVerifyPayments,
    canScanConfirmPickup: admin.canScanConfirmPickup,
    canManageProductsBatches: admin.canManageProductsBatches,
    canAdjustInventory: admin.canAdjustInventory,
    canManageShipping: admin.canManageShipping,
    canViewAuditLog: admin.canViewAuditLog,
  };
}
