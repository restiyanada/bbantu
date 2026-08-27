import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAdminAuth } from "@/lib/adminAuth";
import { Button } from "@/components/ui/button";

/**
 * Wraps the four admin/staff routes (§18.4). Three states beyond "loading":
 *
 *   - No session at all            → redirect to /admin/login.
 *   - Session exists, whoami 403'd → this person isn't in admin_users;
 *     show that plainly rather than silently bouncing them (they might be a
 *     customer who somehow hit an admin URL, or a staff member not yet
 *     added — different next steps, so don't hide which one it is).
 *   - Session + valid admin        → render the page.
 *
 * Deliberately does NOT check a specific permission here — per §18.4 "the
 * dashboard itself is read-only for everyone regardless of permissions",
 * every admin can reach every admin page; individual actions inside each
 * page disable themselves based on useAdminAuth().admin's flags instead.
 */
export default function RequireAdmin({ children }: { children: ReactNode }) {
  const { loading, session, admin, profileError, signOut } = useAdminAuth();

  if (loading) {
    return <main className="p-8 text-sm text-muted-foreground">Loading…</main>;
  }

  if (!session) {
    return <Navigate to="/admin/login" replace />;
  }

  if (!admin) {
    return (
      <main className="p-8 max-w-md space-y-3">
        <h1 className="text-lg font-semibold">Not authorized</h1>
        <p className="text-sm text-muted-foreground">{profileError ?? "This account isn't set up as an admin."}</p>
        <Button size="sm" variant="outline" onClick={() => void signOut()}>
          Sign out
        </Button>
      </main>
    );
  }

  return <>{children}</>;
}
