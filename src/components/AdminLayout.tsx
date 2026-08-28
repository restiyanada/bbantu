import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { ClipboardList, Package, Layers, History, QrCode, LogOut } from "lucide-react";
import { useAdminAuth } from "@/lib/adminAuth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Orders", icon: ClipboardList },
  { to: "/admin/products", label: "Products", icon: Package },
  { to: "/admin/batches", label: "Batches", icon: Layers },
  { to: "/admin/audit-log", label: "Audit log", icon: History },
  { to: "/scan", label: "Scan", icon: QrCode },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors shrink-0",
                isActive
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )
            }
          >
            <Icon className="size-4 shrink-0" />
            <span className="whitespace-nowrap">{item.label}</span>
          </NavLink>
        );
      })}
    </>
  );
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { admin, signOut } = useAdminAuth();
  const displayName = admin?.name ?? admin?.email ?? "";

  return (
    <div className="min-h-screen bg-background md:flex">
      <aside className="hidden md:flex md:w-60 md:shrink-0 md:flex-col border-r bg-card">
        <div className="h-14 flex items-center px-5 border-b">
          <span className="font-semibold tracking-tight">Admin</span>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          <NavLinks />
        </nav>
        <div className="p-3 border-t">
          {displayName && (
            <div className="flex items-center gap-2 px-1 pb-2 text-sm text-muted-foreground min-w-0">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground text-xs font-semibold">
                {initials(displayName)}
              </span>
              <span className="truncate">{displayName}</span>
            </div>
          )}
          <Button size="sm" variant="ghost" className="w-full justify-start" onClick={() => void signOut()}>
            <LogOut className="size-4" />
            Sign out
          </Button>
        </div>
      </aside>

      <header className="md:hidden border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 sticky top-0 z-10 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
        <div className="px-4 h-14 flex items-center justify-between gap-3">
          <span className="font-semibold tracking-tight shrink-0">Admin</span>
          <Button size="sm" variant="ghost" onClick={() => void signOut()}>
            <LogOut className="size-4" />
          </Button>
        </div>
        <nav className="flex gap-1 px-3 pb-2 overflow-x-auto">
          <NavLinks />
        </nav>
      </header>

      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
