import { Routes, Route } from "react-router-dom";
import HomePage from "./pages/HomePage";
import OrderPage from "./pages/OrderPage";
import AdminDashboardPage from "./pages/AdminDashboardPage";
import ScanPage from "./pages/ScanPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/orders/:accessToken" element={<OrderPage />} />
      <Route path="/dashboard" element={<AdminDashboardPage />} />
      <Route path="/scan" element={<ScanPage />} />
    </Routes>
  );
}
