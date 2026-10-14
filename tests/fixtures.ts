import type { Dataset, PivotConfig } from "../src/lib/pivot/types";

export const sales: Dataset = {
  columns: [
    { name: "region", type: "string" },
    { name: "product", type: "string" },
    { name: "year", type: "number" },
    { name: "amount", type: "number" },
    { name: "sold_at", type: "date" },
  ],
  rows: [
    ["East", "A", 2022, 10, "2022-01-15 10:00:00"],
    ["East", "B", 2022, 20, "2022-02-10"],
    ["East", "A", 2023, 30, "2023-03-01"],
    ["West", "A", 2022, 5, "2022-05-05"],
    ["West", "B", 2023, "15", "2023-07-07"],
    ["West", "B", 2023, null, "2023-07-08"],
  ],
};

export function config(partial: Partial<PivotConfig> = {}): PivotConfig {
  return {
    rows: [],
    cols: [],
    values: [],
    filters: [],
    fieldOptions: {},
    valuesOn: "cols",
    rowTotals: true,
    colTotals: true,
    subtotals: false,
    decimals: "auto",
    ...partial,
  };
}

export const sum = (field: string, extra: Record<string, unknown> = {}) => ({
  id: `sum-${field}`,
  field,
  agg: "sum" as const,
  showAs: "value" as const,
  ...extra,
});
