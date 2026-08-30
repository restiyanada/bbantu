import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { db } from "../_shared/db.ts";
import { handleCors } from "../_shared/cors.ts";
import { HttpError, json, errorResponse, isUniqueViolation } from "../_shared/http.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { fetchWithTimeout } from "../_shared/fetch-with-timeout.ts";
import { adminUsers } from "../../../db/schema.ts";
import { logAudit } from "../../../lib/audit.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be available.");
}
const frontendBaseUrl = Deno.env.get("FRONTEND_BASE_URL");
if (!frontendBaseUrl) throw new Error("FRONTEND_BASE_URL must be set as a Supabase Edge Function secret.");

// Service-role client, used only for auth.admin.inviteUserByEmail — the one
// thing here that isn't a plain table write and has to go through Supabase
// Auth itself (password hashing, the invite token, its own email send).
const authAdminClient = createClient(supabaseUrl, serviceRoleKey, { global: { fetch: fetchWithTimeout(8000) } });

const inviteSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  email: z.string().trim().toLowerCase().email("A valid email is required."),
  permissions: z.object({
    canVerifyPayments: z.boolean(),
    canScanConfirmPickup: z.boolean(),
    canManageProductsBatches: z.boolean(),
    canAdjustInventory: z.boolean(),
    canManageShipping: z.boolean(),
    canViewAuditLog: z.boolean(),
  }),
});

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  let input: z.infer<typeof inviteSchema>;
  try {
    input = inviteSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return json({ error: "Invalid request.", details: err.issues }, 400);
    }
    return json({ error: "Invalid JSON body." }, 400);
  }

  try {
    // Any existing admin can invite another — there's no "manage admins"
    // permission of its own, and this is a small, already-trusted team.
    const admin = await requireAdmin(req, null);

    let newAdmin: typeof adminUsers.$inferSelect;
    try {
      [newAdmin] = await db
        .insert(adminUsers)
        .values({ name: input.name, email: input.email, ...input.permissions })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new HttpError(409, "This email is already registered as an admin.");
      }
      throw err;
    }

    await logAudit(db, {
      actorId: admin.id,
      entityType: "admin_user",
      entityId: newAdmin.id,
      action: "admin invited",
      after: { email: newAdmin.email, ...input.permissions },
    });

    const { error: inviteError } = await authAdminClient.auth.admin.inviteUserByEmail(input.email, {
      redirectTo: `${frontendBaseUrl}/admin/accept-invite`,
    });

    // The admin_users row above is what actually grants access — it's already
    // committed either way. The most common failure here is an email that
    // already has an auth.users row (e.g. someone who previously used the old
    // OTP login): they can still get in via "Forgot password" on the login
    // page, so this isn't fatal, just worth telling the caller about.
    if (inviteError) {
      console.error(`invite-admin: inviteUserByEmail failed for ${input.email}:`, inviteError);
    }

    return json({ adminId: newAdmin.id, inviteSent: !inviteError }, 201);
  } catch (err) {
    return errorResponse(err, "Unexpected error inviting admin.");
  }
});
