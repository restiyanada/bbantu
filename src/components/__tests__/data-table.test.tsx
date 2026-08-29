// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { createColumnHelper } from "@tanstack/react-table";
import { DataTable, type DataTableFilter } from "../data-table";

// Self-contained to this file rather than a global setup — the rest of this
// suite runs its pure lib/ tests under vitest's `node` environment, which has
// no `document` for jest-dom/RTL cleanup to touch.
afterEach(cleanup);

interface Row {
  id: string;
  name: string;
  status: string;
}

const columnHelper = createColumnHelper<Row>();
const columns = [
  columnHelper.accessor("name", { header: "Name" }),
  columnHelper.accessor("status", { header: "Status" }),
];

const rows: Row[] = [
  { id: "1", name: "Siti Rahayu", status: "PENDING" },
  { id: "2", name: "Budi Santoso", status: "VERIFIED" },
];

describe("DataTable", () => {
  // Functional coverage for the search box: typing narrows the visible rows.
  // Not a regression guard for the infinite-render-loop incident (see the E2E
  // spec for that) — I tried making it one by reverting the fix under this
  // same test and it still passed. jsdom has no real microtask/paint pipeline,
  // and the bug was specifically that starvation on the real one; a fake DOM
  // can't reproduce a fight over a queue it doesn't have.
  it("narrows visible rows when searching", async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} data={rows} searchableText={(r) => r.name} />);

    expect(screen.getByText("Siti Rahayu")).toBeInTheDocument();
    expect(screen.getByText("Budi Santoso")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Search…"), "Budi");

    expect(screen.queryByText("Siti Rahayu")).not.toBeInTheDocument();
    expect(screen.getByText("Budi Santoso")).toBeInTheDocument();
  });

  it("applies a select filter and clears it", async () => {
    const user = userEvent.setup();
    let statusValue = "";
    const setStatus = (v: string) => {
      statusValue = v;
    };

    function Wrapper() {
      const [, setTick] = useState(0);
      const filters: DataTableFilter<Row>[] = [
        {
          label: "All statuses",
          value: statusValue,
          onChange: (v) => {
            setStatus(v);
            setTick((t: number) => t + 1);
          },
          options: [
            { label: "Pending", value: "PENDING" },
            { label: "Verified", value: "VERIFIED" },
          ],
          predicate: (row, value) => row.status === value,
        },
      ];
      return <DataTable columns={columns} data={rows} filters={filters} />;
    }

    render(<Wrapper />);
    expect(screen.getByText("Siti Rahayu")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox"), "VERIFIED");
    expect(screen.queryByText("Siti Rahayu")).not.toBeInTheDocument();
    expect(screen.getByText("Budi Santoso")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /clear filters/i }));
    expect(screen.getByText("Siti Rahayu")).toBeInTheDocument();
  });
});
