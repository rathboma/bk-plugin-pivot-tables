import { describe, expect, it } from "vitest";
import { computePivot } from "../src/lib/pivot/engine";
import { buildGrid, flatHeader, type GridCell, type PivotGrid } from "../src/lib/pivot/grid";
import type { PivotConfig } from "../src/lib/pivot/types";
import { config, sales, sum } from "./fixtures";

const grid = (c: Partial<PivotConfig>) => buildGrid(computePivot(sales, config(c)));

/** Visible cells as text; covered cells as "~". */
function matrix(g: PivotGrid): string[][] {
  const show = (row: GridCell[]) => row.map((c) => (c.hidden ? "~" : c.text));
  const out = g.header.map(show);
  for (let i = 0; i < g.bodyRowCount; i++) out.push(show(g.bodyRow(i)));
  return out;
}

describe("buildGrid", () => {
  it("lays out a simple crosstab with totals", () => {
    const g = grid({ rows: ["region"], cols: ["year"], values: [sum("amount")] });
    expect(matrix(g)).toEqual([
      ["year", "2022", "2023", "Total"],
      ["region", "Sum of amount", "Sum of amount", "Sum of amount"],
      ["East", "30", "30", "60"],
      ["West", "5", "15", "20"],
      ["Total", "35", "45", "80"],
    ]);
    expect(g.width).toBe(4);
    expect(g.headerRows).toBe(2);
    expect(g.rowHeaderCols).toBe(1);
  });

  it("can hide totals", () => {
    const g = grid({ rows: ["region"], cols: ["year"], values: [sum("amount")], rowTotals: false, colTotals: false });
    expect(matrix(g)).toEqual([
      ["year", "2022", "2023"],
      ["region", "Sum of amount", "Sum of amount"],
      ["East", "30", "30"],
      ["West", "5", "15"],
    ]);
  });

  it("handles no rows and no columns", () => {
    expect(matrix(grid({}))).toEqual([
      ["", "Count"],
      ["Total", "6"],
    ]);
  });

  it("spans row labels and adds subtotals", () => {
    const g = grid({ rows: ["region", "product"], values: [sum("amount")], subtotals: true });
    expect(matrix(g)).toEqual([
      ["region", "product", "Sum of amount"],
      ["East", "A", "40"],
      ["~", "B", "20"],
      ["East Total", "~", "60"],
      ["West", "A", "5"],
      ["~", "B", "15"],
      ["West Total", "~", "20"],
      ["Total", "~", "80"],
    ]);
    expect(g.bodyRow(0)[0].rowSpan).toBe(2);
    expect(g.bodyRow(2)[0].colSpan).toBe(2);
    expect(g.bodyRow(2)[2].total).toBe("sub");
    expect(g.bodyRow(6)[2].total).toBe("grand");
    // Covered row labels repeat their label (for CSV), totals don't.
    expect(g.bodyRow(1)[0].text).toBe("East");
    expect(g.bodyRow(2)[1].text).toBe("");
  });

  it("spans column headers across multiple values and levels", () => {
    const g = grid({
      cols: ["region", "product"],
      values: [sum("amount"), { id: "c", field: null, agg: "count", showAs: "value" }],
      subtotals: true,
    });
    const m = matrix(g);
    expect(m[0]).toEqual(["region", "East", "~", "~", "~", "East Total", "~", "West", "~", "~", "~", "West Total", "~", "Total", "~"]);
    expect(m[1]).toEqual(["product", "A", "~", "B", "~", "~", "~", "A", "~", "B", "~", "~", "~", "~", "~"]);
    expect(m[2].slice(0, 5)).toEqual(["", "Sum of amount", "Count", "Sum of amount", "Count"]);
    expect(m[3]).toEqual(["Total", "40", "2", "20", "1", "60", "3", "5", "1", "15", "2", "20", "3", "80", "6"]);
    expect(g.header[0][1].colSpan).toBe(4);
    expect(g.header[0][5].rowSpan).toBe(2);
    expect(g.header[0][13].rowSpan).toBe(2);
  });

  it("puts multiple values on rows", () => {
    const g = grid({
      rows: ["region"],
      cols: ["year"],
      values: [sum("amount"), { id: "c", field: null, agg: "count", showAs: "value" }],
      valuesOn: "rows",
    });
    expect(matrix(g)).toEqual([
      ["year", "~", "2022", "2023", "Total"],
      ["region", "Values", "", "", ""],
      ["East", "Sum of amount", "30", "30", "60"],
      ["~", "Count", "2", "1", "3"],
      ["West", "Sum of amount", "5", "15", "20"],
      ["~", "Count", "1", "2", "3"],
      ["Total", "Sum of amount", "35", "45", "80"],
      ["~", "Count", "3", "3", "6"],
    ]);
    expect(g.bodyRow(0)[0].rowSpan).toBe(2);
  });

  it("shows values as percentages", () => {
    const g = grid({ rows: ["region"], cols: ["year"], values: [sum("amount", { showAs: "pctRowTotal" })] });
    const east = g.bodyRow(0);
    expect(east[1].value).toBe(0.5);
    expect(east[1].percent).toBe(true);
    expect(east[3].value).toBe(1);
    const grand = grid({ rows: ["region"], values: [sum("amount", { showAs: "pctGrandTotal" })] });
    expect(grand.bodyRow(0)[1].value).toBe(0.75);
    const col = grid({ rows: ["region"], cols: ["year"], values: [sum("amount", { showAs: "pctColTotal" })] });
    expect(col.bodyRow(1)[2].value).toBeCloseTo(15 / 45);
  });

  it("flattens multi-level headers", () => {
    const g = grid({ rows: ["region"], cols: ["year", "product"], values: [sum("amount")] });
    expect(flatHeader(g)).toEqual(["region", "2022 / A", "2022 / B", "2023 / A", "2023 / B", "Total"]);
    const two = grid({
      rows: ["region"],
      cols: ["year"],
      values: [sum("amount"), { id: "c", field: null, agg: "count", showAs: "value" }],
    });
    expect(flatHeader(two)).toEqual([
      "region",
      "2022 / Sum of amount",
      "2022 / Count",
      "2023 / Sum of amount",
      "2023 / Count",
      "Total / Sum of amount",
      "Total / Count",
    ]);
  });

  it("labels date-grouped fields", () => {
    const g = grid({ rows: ["sold_at"], fieldOptions: { sold_at: { dateGroup: "year" } } });
    expect(g.header[0][0].text).toBe("sold_at (Year)");
  });
});

describe("number formatting", () => {
  it("uses consistent decimals per value field in auto mode", () => {
    const g = grid({
      rows: ["region"],
      values: [
        sum("amount"),
        { id: "a", field: "amount", agg: "avg", showAs: "value" },
        sum("amount", { id: "p", showAs: "pctGrandTotal" }),
      ],
    });
    const east = g.bodyRow(0);
    expect(east.slice(1).map((c) => c.text)).toEqual(["60", "20.00", "75.0%"]);
    expect(east[2].digits).toBe(2);
    const fixed = grid({ rows: ["region"], values: [sum("amount")], decimals: 3 });
    expect(fixed.bodyRow(0)[1].text).toBe("60.000");
  });
});

describe("bodyRow column limit", () => {
  it("stops building cells at the limit", () => {
    const g = grid({ rows: ["region"], cols: ["year"], values: [sum("amount")] });
    expect(g.bodyRow(0)).toHaveLength(4);
    expect(g.bodyRow(0, 2).map((c) => c.text)).toEqual(["East", "30"]);
  });
});
