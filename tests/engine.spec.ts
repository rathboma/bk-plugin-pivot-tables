import { describe, expect, it } from "vitest";
import { computePivot, distinctValues } from "../src/lib/pivot/engine";
import { createAggregator } from "../src/lib/pivot/aggregators";
import { groupedLabel, toLabel, toNumber } from "../src/lib/pivot/values";
import { config, sales, sum } from "./fixtures";

describe("values", () => {
  it("parses numbers from numbers, bigints and numeric strings", () => {
    expect(toNumber(5)).toBe(5);
    expect(toNumber(BigInt(7))).toBe(7);
    expect(toNumber(" 12.5 ")).toBe(12.5);
    expect(toNumber("1e3")).toBe(1000);
    expect(toNumber("abc")).toBeNaN();
    expect(toNumber(null)).toBeNaN();
    expect(toNumber(true)).toBeNaN();
  });

  it("labels nulls, empties and objects", () => {
    expect(toLabel(null)).toBe("(null)");
    expect(toLabel(undefined)).toBe("(null)");
    expect(toLabel("")).toBe("(empty)");
    expect(toLabel({ a: 1 })).toBe('{"a":1}');
    expect(toLabel(false)).toBe("false");
  });

  it("groups dates as written, without time zone shifts", () => {
    expect(groupedLabel("2024-01-15T23:30:00Z", "day").label).toBe("2024-01-15");
    expect(groupedLabel("2024-01-15 23:30:00", "hour").label).toBe("2024-01-15 23:00");
    expect(groupedLabel("2024-05-15", "quarter").label).toBe("2024-Q2");
    expect(groupedLabel("2024-05-15", "month").label).toBe("2024-05");
    expect(groupedLabel("2024-05-15", "year").label).toBe("2024");
    expect(groupedLabel("2021-01-03", "week").label).toBe("2020-W53");
    expect(groupedLabel("2024-12-30", "week").label).toBe("2025-W01");
    expect(groupedLabel("2024-05-15", "dayOfWeek")).toEqual({ label: "Wed", sort: 2 });
    expect(groupedLabel("2024-05-15", "monthOfYear")).toEqual({ label: "May", sort: 5 });
    expect(groupedLabel("not a date", "month").label).toBe("not a date");
    expect(groupedLabel(null, "month").label).toBe("(null)");
  });
});

describe("aggregators", () => {
  const run = (id: Parameters<typeof createAggregator>[0], xs: unknown[]) => {
    const a = createAggregator(id);
    xs.forEach((x) => a.push(x));
    return a.value();
  };

  it("computes the numeric aggregates", () => {
    const xs = [1, "2", 3, null, "x", 4];
    expect(run("count", xs)).toBe(5);
    expect(run("countDistinct", [1, 1, "1", 2, null])).toBe(2);
    expect(run("sum", xs)).toBe(10);
    expect(run("avg", xs)).toBe(2.5);
    expect(run("min", xs)).toBe(1);
    expect(run("max", xs)).toBe(4);
    expect(run("median", xs)).toBe(2.5);
    expect(run("median", [5, 1, 3])).toBe(3);
    expect(run("variance", [2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(4.571428, 5);
    expect(run("stdev", [2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 5);
  });

  it("returns null when there is nothing to aggregate", () => {
    expect(run("sum", [null, "x"])).toBeNull();
    expect(run("avg", [])).toBeNull();
    expect(run("stdev", [1])).toBeNull();
  });

  it("supports min/max/first/last on text", () => {
    expect(run("min", ["pear", "apple", null])).toBe("apple");
    expect(run("max", ["2024-01-02", "2023-12-31"])).toBe("2024-01-02");
    expect(run("first", [null, "b", "c"])).toBe("b");
    expect(run("last", ["b", "c", null])).toBe("c");
  });
});

describe("computePivot", () => {
  it("counts rows when no values are configured", () => {
    const r = computePivot(sales, config({ rows: ["region"] }));
    expect(r.rowKeys).toEqual([["East"], ["West"]]);
    expect(r.get(["East"], [], 0)).toBe(3);
    expect(r.get([], [], 0)).toBe(6);
  });

  it("aggregates across rows and columns with totals", () => {
    const r = computePivot(sales, config({ rows: ["region"], cols: ["year"], values: [sum("amount")] }));
    expect(r.colKeys).toEqual([["2022"], ["2023"]]);
    expect(r.get(["East"], ["2022"], 0)).toBe(30);
    expect(r.get(["West"], ["2023"], 0)).toBe(15);
    expect(r.get(["East"], [], 0)).toBe(60);
    expect(r.get([], ["2022"], 0)).toBe(35);
    expect(r.get([], [], 0)).toBe(80);
    expect(r.get(["Nowhere"], [], 0)).toBeNull();
  });

  it("computes subtotals for key prefixes", () => {
    const r = computePivot(sales, config({ rows: ["region", "product"], values: [sum("amount")] }));
    expect(r.rowKeys).toEqual([
      ["East", "A"],
      ["East", "B"],
      ["West", "A"],
      ["West", "B"],
    ]);
    expect(r.get(["East"], [], 0)).toBe(60);
    expect(r.get(["West", "B"], [], 0)).toBe(15);
  });

  it("filters out excluded labels", () => {
    const r = computePivot(
      sales,
      config({ rows: ["region"], filters: ["product"], values: [sum("amount")], fieldOptions: { product: { exclude: ["B"] } } })
    );
    expect(r.matchedRecords).toBe(3);
    expect(r.get(["East"], [], 0)).toBe(40);
    expect(r.get([], [], 0)).toBe(45);
  });

  it("ignores filters on fields that aren't in the pivot", () => {
    const r = computePivot(sales, config({ rows: ["region"], fieldOptions: { product: { exclude: ["B"] } } }));
    expect(r.matchedRecords).toBe(6);
  });

  it("sorts keys by label and by value", () => {
    const desc = computePivot(sales, config({ rows: ["region"], fieldOptions: { region: { sort: "desc" } } }));
    expect(desc.rowKeys).toEqual([["West"], ["East"]]);

    const byValue = computePivot(
      sales,
      config({ rows: ["product"], values: [sum("amount")], fieldOptions: { product: { sort: "valueDesc" } } })
    );
    // A = 45, B = 35
    expect(byValue.rowKeys).toEqual([["A"], ["B"]]);
    const byValueAsc = computePivot(
      sales,
      config({ rows: ["product"], values: [sum("amount")], fieldOptions: { product: { sort: "valueAsc" } } })
    );
    expect(byValueAsc.rowKeys).toEqual([["B"], ["A"]]);
  });

  it("sorts numbers numerically and puts nulls last", () => {
    const ds = {
      columns: [{ name: "n", type: "number" as const }],
      rows: [[10], [9], [null], [100]],
    };
    const r = computePivot(ds, config({ rows: ["n"] }));
    expect(r.rowKeys).toEqual([["9"], ["10"], ["100"], ["(null)"]]);
  });

  it("groups dates and keeps calendar order for named groups", () => {
    const r = computePivot(sales, config({ rows: ["sold_at"], fieldOptions: { sold_at: { dateGroup: "monthOfYear" } } }));
    expect(r.rowKeys.map((k) => k[0])).toEqual(["Jan", "Feb", "Mar", "May", "Jul"]);
    const q = computePivot(sales, config({ cols: ["sold_at"], fieldOptions: { sold_at: { dateGroup: "quarter" } } }));
    expect(q.colKeys.map((k) => k[0])).toEqual(["2022-Q1", "2022-Q2", "2023-Q1", "2023-Q3"]);
    expect(q.get([], ["2023-Q3"], 0)).toBe(2);
  });

  it("drops fields the dataset doesn't have", () => {
    const r = computePivot(sales, config({ rows: ["missing", "region"], values: [sum("gone")] }));
    expect(r.config.rows).toEqual(["region"]);
    expect(r.values).toHaveLength(1);
    expect(r.values[0].field).toBeNull();
  });

  it("lists distinct values with counts", () => {
    expect(distinctValues(sales, "region", config())).toEqual([
      { label: "East", count: 3 },
      { label: "West", count: 3 },
    ]);
    const days = distinctValues(sales, "sold_at", config({ fieldOptions: { sold_at: { dateGroup: "dayOfWeek" } } }));
    expect(days.map((d) => d.label)).toEqual(["Wed", "Thu", "Fri", "Sat"]);
  });

  it("handles a large dataset quickly", () => {
    const rows: unknown[][] = [];
    for (let i = 0; i < 100_000; i++) rows.push([`r${i % 50}`, `c${i % 12}`, i % 7, i]);
    const ds = {
      columns: ["a", "b", "c", "n"].map((name) => ({ name, type: "string" as const })),
      rows,
    };
    const start = performance.now();
    const r = computePivot(ds, config({ rows: ["a", "c"], cols: ["b"], values: [sum("n")], subtotals: true }));
    const elapsed = performance.now() - start;
    expect(r.rowKeys.length).toBe(350);
    expect(r.get([], [], 0)).toBe((99_999 * 100_000) / 2);
    expect(elapsed).toBeLessThan(3000);
  });
});
