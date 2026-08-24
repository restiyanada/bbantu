import {
  useReactTable,
  getCoreRowModel,
  createColumnHelper,
  flexRender,
} from "@tanstack/react-table";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Dummy rows only — proves TanStack Table + Badge render together.
// Real data comes from Supabase once Milestone 1 builds the actual queries.
type DemoOrder = {
  id: string;
  customerName: string;
  status: "PAYMENT_PENDING" | "READY_FOR_PICKUP" | "SHIPPED";
};

const demoOrders: DemoOrder[] = [
  { id: "ORD-001", customerName: "Aditya P.", status: "PAYMENT_PENDING" },
  { id: "ORD-002", customerName: "Sarah W.", status: "READY_FOR_PICKUP" },
  { id: "ORD-003", customerName: "Budi S.", status: "SHIPPED" },
];

const statusVariant: Record<DemoOrder["status"], "secondary" | "default" | "outline"> = {
  PAYMENT_PENDING: "secondary",
  READY_FOR_PICKUP: "default",
  SHIPPED: "outline",
};

const columnHelper = createColumnHelper<DemoOrder>();
const columns = [
  columnHelper.accessor("id", { header: "Order ID" }),
  columnHelper.accessor("customerName", { header: "Customer" }),
  columnHelper.accessor("status", {
    header: "Status",
    cell: (info) => (
      <Badge variant={statusVariant[info.getValue()]}>{info.getValue()}</Badge>
    ),
  }),
];

export default function AdminDashboardPage() {
  const table = useReactTable({
    data: demoOrders,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <main className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Admin Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Widgets below are placeholders (dummy data) — PRD §18.1. Real
          Supabase queries come in Milestone 4.
        </p>
      </div>

      {/* §18.1 dashboard widgets — shown here as Cards to confirm the
          component + Tailwind theme wiring works end to end */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Payment verification queue</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">—</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>DP balances due</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">—</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Ready for pickup</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">—</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Missing tracking numbers</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">—</CardContent>
        </Card>
      </div>

      {/* §18.2 order search/filter — TanStack Table proof of wiring */}
      <div>
        <h2 className="text-lg font-medium mb-2">Recent orders (demo data)</h2>
        <table className="w-full text-sm border rounded-md overflow-hidden">
          <thead className="bg-muted">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className="text-left p-2 font-medium">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-t">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="p-2">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
