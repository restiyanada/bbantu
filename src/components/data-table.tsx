import { useState } from "react";
import { useReactTable, getCoreRowModel, flexRender, type ColumnDef } from "@tanstack/react-table";

export interface DataTableFilter<TData> {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  predicate: (row: TData, value: string) => boolean;
}

interface DataTableProps<TData> {
  columns: ColumnDef<TData, any>[];
  data: TData[];
  emptyMessage?: string;
  searchPlaceholder?: string;
  searchableText?: (row: TData) => string;
  filters?: Array<DataTableFilter<TData>>;
}

export function DataTable<TData>({
  columns,
  data,
  emptyMessage = "No results.",
  searchPlaceholder = "Search…",
  searchableText,
  filters,
}: DataTableProps<TData>) {
  const [search, setSearch] = useState("");

  const filteredData = data.filter((row) => {
    if (filters?.some((f) => f.value && !f.predicate(row, f.value))) return false;
    if (searchableText && search.trim()) {
      return searchableText(row).toLowerCase().includes(search.trim().toLowerCase());
    }
    return true;
  });

  const table = useReactTable({
    data: filteredData,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const hasControls = Boolean(searchableText) || Boolean(filters?.length);

  return (
    <div className="space-y-3">
      {hasControls && (
        <div className="flex flex-wrap gap-2 items-center">
          {searchableText && (
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full sm:w-64 rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          )}
          {filters?.map((f) => (
            <select
              key={f.label}
              value={f.value}
              onChange={(e) => f.onChange(e.target.value)}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">{f.label}</option>
              {f.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ))}
          {(search || filters?.some((f) => f.value)) && (
            <button
              type="button"
              className="text-xs text-blue-600 underline"
              onClick={() => {
                setSearch("");
                filters?.forEach((f) => f.onChange(""));
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className="text-left p-2 font-medium whitespace-nowrap">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-t align-top">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="p-2">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {table.getRowModel().rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="p-4 text-center text-gray-500">
                  {data.length === 0 ? emptyMessage : "No results match your search/filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
