import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAdminAuth } from "@/lib/adminAuth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Orders" },
  { to: "/admin/products", label: "Products" },
  { to: "/admin/batches", label: "Batches" },
  { to: "/admin/audit-log", label: "Audit log" },
  { to: "/scan", label: "Scan" },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { admin, signOut } = useAdminAuth();
  const displayName = admin?.name ?? admin?.email ?? "";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 sticky top-0 z-10 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6 min-w-0">
            <span className="font-semibold tracking-tight text-foreground shrink-0">Admin</span>
            <nav className="flex flex-wrap gap-1 text-sm">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      "px-3 py-1.5 rounded-md font-medium transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground shadow-xs"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm shrink-0">
            {displayName && (
              <span className="hidden sm:flex items-center gap-2 text-muted-foreground">
                <span className="flex size-7 items-center justify-center rounded-full bg-accent text-accent-foreground text-xs font-semibold">
                  {initials(displayName)}
                </span>
                {displayName}
              </span>
            )}
            <Button size="sm" variant="ghost" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
