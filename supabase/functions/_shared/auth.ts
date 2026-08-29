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
const authClient = createClient(supabaseUrl, anonKey);

function bearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export async function requireAdmin(req: Request, permission: AdminPermission | null): Promise<AuthenticatedAdmin> {
  const token = bearerToken(req);
  if (!token) {
    throw new HttpError(401, "Not authenticated. Please log in.");
  }

  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user?.email) {
    throw new HttpError(401, "Your session has expired. Please log in again.");
  }

  // Supabase Auth always lowercases auth.users.email; admin_users.email is
  // hand-inserted and is only lowercase because migration 0012's trigger
  // enforces it. Lowering the incoming side too costs nothing and removes the
  // single remaining place a case mismatch could deny someone who is, by every
  // other measure, an admin.
  const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.email, data.user.email.toLowerCase()));
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
