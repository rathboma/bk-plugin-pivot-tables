import { describe, expect, it } from "vitest";
import { applyDrop, axisOf, defaultConfig, suggestConfig } from "../src/lib/state";
import { sales } from "./fixtures";

describe("applyDrop", () => {
  it("adds fields from the field list to an axis", () => {
    const c = applyDrop(defaultConfig(), { field: "region", from: "fields" }, "rows", 0, sales);
    expect(c.rows).toEqual(["region"]);
  });

  it("moves a field between axes", () => {
    let c = { ...defaultConfig(), rows: ["region", "product"] };
    c = applyDrop(c, { field: "region", from: "rows" }, "cols", 0, sales);
    expect(c.rows).toEqual(["product"]);
    expect(c.cols).toEqual(["region"]);
    expect(axisOf(c, "region")).toBe("cols");
  });

  it("reorders within an axis", () => {
    const c = applyDrop({ ...defaultConfig(), rows: ["a", "b", "c"] }, { field: "a", from: "rows" }, "rows", 2, sales);
    expect(c.rows).toEqual(["b", "a", "c"]);
    const d = applyDrop({ ...defaultConfig(), rows: ["a", "b", "c"] }, { field: "c", from: "rows" }, "rows", 0, sales);
    expect(d.rows).toEqual(["c", "a", "b"]);
  });

  it("adds values with a type-appropriate aggregator", () => {
    let c = applyDrop(defaultConfig(), { field: "amount", from: "fields" }, "values", 0, sales);
    c = applyDrop(c, { field: "region", from: "rows" }, "values", 1, sales);
    expect(c.values.map((v) => [v.field, v.agg])).toEqual([
      ["amount", "sum"],
      ["region", "count"],
    ]);
  });

  it("reorders values and removes them by dropping on the field list", () => {
    let c = applyDrop(defaultConfig(), { field: "amount", from: "fields" }, "values", 0, sales);
    c = applyDrop(c, { field: null, from: "fields" }, "values", 1, sales);
    const [first, second] = c.values;
    c = applyDrop(c, { field: null, from: "values", valueId: second.id }, "values", 0, sales);
    expect(c.values.map((v) => v.id)).toEqual([second.id, first.id]);
    c = applyDrop(c, { field: null, from: "values", valueId: first.id }, "fields", 0, sales);
    expect(c.values.map((v) => v.id)).toEqual([second.id]);
  });

  it("clears a field's filter when it's removed", () => {
    const start = { ...defaultConfig(), filters: ["region"], fieldOptions: { region: { exclude: ["East"], sort: "desc" as const } } };
    const c = applyDrop(start, { field: "region", from: "filters" }, "fields", 0, sales);
    expect(c.filters).toEqual([]);
    expect(c.fieldOptions.region).toEqual({ exclude: [], sort: "desc" });
    expect(start.filters).toEqual(["region"]);
  });
});

describe("suggestConfig", () => {
  it("picks a low-cardinality text column for rows and counts", () => {
    const c = suggestConfig(sales);
    expect(c.rows).toEqual(["region"]);
    expect(c.values).toHaveLength(1);
    expect(c.values[0].field).toBeNull();
  });
});
