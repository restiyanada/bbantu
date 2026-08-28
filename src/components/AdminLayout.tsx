import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAdminAuth } from "@/lib/adminAuth";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Orders" },
  { to: "/admin/products", label: "Products" },
  { to: "/admin/batches", label: "Batches" },
  { to: "/admin/audit-log", label: "Audit log" },
  { to: "/scan", label: "Scan" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { admin, signOut } = useAdminAuth();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 py-3 flex flex-wrap items-center justify-between gap-3">
          <nav className="flex flex-wrap gap-1 text-sm">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "px-3 py-1.5 rounded-md transition-colors",
                    isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground hidden sm:inline">{admin?.name ?? admin?.email}</span>
            <button type="button" className="text-gray-500 underline" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
