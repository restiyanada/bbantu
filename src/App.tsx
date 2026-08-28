import { Routes, Route } from "react-router-dom";
import HomePage from "./pages/HomePage";
import OrderPage from "./pages/OrderPage";
import FindOrderPage from "./pages/FindOrderPage";
import AdminDashboardPage from "./pages/AdminDashboardPage";
import AdminProductsPage from "./pages/AdminProductsPage";
import AdminBatchesPage from "./pages/AdminBatchesPage";
import AdminAuditLogPage from "./pages/AdminAuditLogPage";
import AdminLoginPage from "./pages/AdminLoginPage";
import ScanPage from "./pages/ScanPage";
import { AdminAuthProvider } from "./lib/adminAuth";
import RequireAdmin from "./components/RequireAdmin";
import { Toaster } from "./components/ui/sonner";

export default function App() {
  return (
    <AdminAuthProvider>
      <Toaster />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/orders/find" element={<FindOrderPage />} />
        <Route path="/orders/:accessToken" element={<OrderPage />} />
        <Route path="/admin/login" element={<AdminLoginPage />} />
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
    </AdminAuthProvider>
  );
}
