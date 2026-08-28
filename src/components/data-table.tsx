import { useState } from "react";
import { useReactTable, getCoreRowModel, flexRender, type ColumnDef } from "@tanstack/react-table";
import { Input, Select } from "@/components/ui/input";

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
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full sm:w-64 h-8"
            />
          )}
          {filters?.map((f) => (
            <Select key={f.label} value={f.value} onChange={(e) => f.onChange(e.target.value)} className="h-8 w-auto">
              <option value="">{f.label}</option>
              {f.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          ))}
          {(search || filters?.some((f) => f.value)) && (
            <button
              type="button"
              className="text-xs text-primary underline underline-offset-2"
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

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="text-left p-3 font-medium text-muted-foreground text-xs uppercase tracking-wide whitespace-nowrap"
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-t align-top hover:bg-muted/40 transition-colors">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="p-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {table.getRowModel().rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="p-6 text-center text-muted-foreground">
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
