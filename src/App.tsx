import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import { AdminAuthProvider } from "./lib/adminAuth";
import RequireAdmin from "./components/RequireAdmin";
import { Toaster } from "./components/ui/sonner";

// Every route is its own chunk, fetched on demand — a customer placing an
// order never downloads the admin dashboard, TanStack Table, or the QR
// scanner, and vice versa. Static imports here would put all of it in one
// bundle regardless of which single page a given visitor actually opens.
const HomePage = lazy(() => import("./pages/HomePage"));
const OrderPage = lazy(() => import("./pages/OrderPage"));
const FindOrderPage = lazy(() => import("./pages/FindOrderPage"));
const AdminDashboardPage = lazy(() => import("./pages/AdminDashboardPage"));
const AdminProductsPage = lazy(() => import("./pages/AdminProductsPage"));
const AdminBatchesPage = lazy(() => import("./pages/AdminBatchesPage"));
const AdminAuditLogPage = lazy(() => import("./pages/AdminAuditLogPage"));
const AdminLoginPage = lazy(() => import("./pages/AdminLoginPage"));
const AdminAcceptInvitePage = lazy(() => import("./pages/AdminAcceptInvitePage"));
const ScanPage = lazy(() => import("./pages/ScanPage"));

function RouteFallback() {
  return <main className="p-8 text-sm text-muted-foreground">Loading…</main>;
}

export default function App() {
  return (
    <AdminAuthProvider>
      <Toaster />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/orders/find" element={<FindOrderPage />} />
          <Route path="/orders/:accessToken" element={<OrderPage />} />
          <Route path="/admin/login" element={<AdminLoginPage />} />
          <Route path="/admin/accept-invite" element={<AdminAcceptInvitePage />} />
          <Route
            path="/dashboard"
            element={
              <RequireAdmin>
                <AdminDashboardPage />
              </RequireAdmin>
            }
          />
          <Route
            path="/admin/products"
            element={
              <RequireAdmin>
                <AdminProductsPage />
              </RequireAdmin>
            }
          />
          <Route
            path="/admin/batches"
            element={
              <RequireAdmin>
                <AdminBatchesPage />
              </RequireAdmin>
            }
          />
          <Route
            path="/admin/audit-log"
            element={
              <RequireAdmin>
                <AdminAuditLogPage />
              </RequireAdmin>
            }
          />
          <Route
            path="/scan"
            element={
              <RequireAdmin>
                <ScanPage />
              </RequireAdmin>
            }
          />
        </Routes>
      </Suspense>
    </AdminAuthProvider>
  );
}
