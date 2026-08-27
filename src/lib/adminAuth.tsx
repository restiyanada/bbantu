import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";

/**
 * §18.4 permission flags for the logged-in admin, as returned by the
 * `whoami` Edge Function. Mirrors db/schema.ts admin_users exactly (minus
 * id/name/email, which live alongside these on the same object below).
 */
export interface AdminProfile {
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

interface AdminAuthState {
  /** True until the initial session check + (if logged in) whoami call both resolve. */
  loading: boolean;
  session: Session | null;
  /** Non-null only once whoami has confirmed this session belongs to a real admin_users row. */
  admin: AdminProfile | null;
  /** Set when a session exists but whoami rejected it (e.g. not an admin) — distinct from "no session at all". */
  profileError: string | null;
  signOut: () => Promise<void>;
  /** Re-runs whoami — useful right after an admin's own permissions might have changed. */
  refreshProfile: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthState | null>(null);

async function fetchWhoami(): Promise<AdminProfile | null> {
  const { data, error } = await supabase.functions.invoke("whoami");
  if (error || !data) return null;
  return data as AdminProfile;
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [admin, setAdmin] = useState<AdminProfile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const loadProfile = useCallback(async (currentSession: Session | null) => {
    if (!currentSession) {
      setAdmin(null);
      setProfileError(null);
      return;
    }
    const profile = await fetchWhoami();
    if (!profile) {
      setAdmin(null);
      setProfileError("This account isn't set up as an admin. Ask an existing admin for access.");
      return;
    }
    setAdmin(profile);
    setProfileError(null);
  }, []);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      await loadProfile(data.session);
      if (active) setLoading(false);
    });

    // Magic-link sign-in (and sign-out from another tab) both land here —
    // supabase-js already parses the callback URL/session for us
    // (detectSessionInUrl defaults true), so this listener is all that's
    // needed to react to it.
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!active) return;
      setSession(newSession);
      void loadProfile(newSession);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [loadProfile]);

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function refreshProfile() {
    await loadProfile(session);
  }

  return (
    <AdminAuthContext.Provider value={{ loading, session, admin, profileError, signOut, refreshProfile }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth(): AdminAuthState {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error("useAdminAuth must be used within an AdminAuthProvider.");
  return ctx;
}
