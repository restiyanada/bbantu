import { useMemo, useRef, useState } from "react";
import { useReactTable, getCoreRowModel, flexRender, type ColumnDef } from "@tanstack/react-table";
import { X } from "lucide-react";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DataTableColumnMeta {
  className?: string;
}

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

  // `filteredData` MUST keep a stable identity between renders. TanStack memoizes
  // the row model on the identity of `data`, and a fresh array makes it rebuild —
  // which queues a page-index auto-reset, which sets state, which renders again,
  // which builds another fresh array. That loop runs in microtasks, so it never
  // yields and the whole tab locks up on the second render of any table.
  // The filters/searchableText props are also rebuilt by callers every render, so
  // they're read through a ref and the memo is keyed on the filter *values*.
  const latest = useRef({ filters, searchableText });
  latest.current = { filters, searchableText };

  const filterKey = filters?.map((f) => f.value).join("\u0000") ?? "";
  const filteredData = useMemo(() => {
    const { filters: activeFilters, searchableText: toText } = latest.current;
    const query = search.trim().toLowerCase();
    return data.filter((row) => {
      if (activeFilters?.some((f) => f.value && !f.predicate(row, f.value))) return false;
      if (toText && query) return toText(row).toLowerCase().includes(query);
      return true;
    });
  }, [data, search, filterKey]);

  const table = useReactTable({
    data: filteredData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    // Every row is rendered — there is no pagination row model to reset, and the
    // reset is what turns an unstable `data` reference into an infinite loop.
    autoResetPageIndex: false,
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
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setSearch("");
                filters?.forEach((f) => f.onChange(""));
              }}
            >
              <X className="size-3.5" />
              Clear filters
            </Button>
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
                    className={cn(
                      "text-left p-3 font-medium text-muted-foreground text-xs uppercase tracking-wide whitespace-nowrap",
                      (header.column.columnDef.meta as DataTableColumnMeta | undefined)?.className
                    )}
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
                  <td
                    key={cell.id}
                    className={cn("p-3", (cell.column.columnDef.meta as DataTableColumnMeta | undefined)?.className)}
                  >
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
