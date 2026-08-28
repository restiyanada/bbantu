import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAdminAuth } from "@/lib/adminAuth";
import { Button } from "@/components/ui/button";

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
