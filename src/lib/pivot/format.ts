import { AGGREGATOR_MAP } from "./aggregators";
import type { DateGrouping, Decimals, PivotConfig, ShowAs, ValueField } from "./types";

const formatters = new Map<string, Intl.NumberFormat>();

/** Format with a fixed number of fraction digits (so a column lines up). */
export function formatNumber(n: number, digits: number, percent = false): string {
  const key = `${digits}|${percent}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(undefined, {
      style: percent ? "percent" : "decimal",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    formatters.set(key, f);
  }
  return f.format(n);
}

/** Fraction digits for a value: explicit setting, or 0 for whole numbers / 2 otherwise (1 for percentages). */
export function resolveDigits(decimals: Decimals, percent: boolean, integer: boolean): number {
  if (decimals !== "auto") return decimals;
  if (percent) return 1;
  return integer ? 0 : 2;
}

/** Excel number format matching what's shown in the UI. */
export function excelNumFmt(digits: number, percent: boolean): string {
  const frac = digits ? `.${"0".repeat(digits)}` : "";
  return percent ? `0${frac}%` : `#,##0${frac}`;
}

export const DATE_GROUPINGS: { id: DateGrouping; label: string }[] = [
  { id: "none", label: "No grouping" },
  { id: "year", label: "Year" },
  { id: "quarter", label: "Quarter" },
  { id: "month", label: "Month" },
  { id: "week", label: "Week" },
  { id: "day", label: "Day" },
  { id: "hour", label: "Hour" },
  { id: "monthOfYear", label: "Month of year" },
  { id: "dayOfWeek", label: "Day of week" },
];

export const SHOW_AS: { id: ShowAs; label: string; suffix: string }[] = [
  { id: "value", label: "Value", suffix: "" },
  { id: "pctGrandTotal", label: "% of grand total", suffix: " (% of total)" },
  { id: "pctRowTotal", label: "% of row total", suffix: " (% of row)" },
  { id: "pctColTotal", label: "% of column total", suffix: " (% of column)" },
];

export function fieldCaption(field: string, config: PivotConfig): string {
  const group = config.fieldOptions[field]?.dateGroup;
  if (!group || group === "none") return field;
  const label = DATE_GROUPINGS.find((g) => g.id === group)?.label ?? group;
  return `${field} (${label})`;
}

export function valueCaption(v: ValueField): string {
  const base = v.field === null ? "Count" : `${AGGREGATOR_MAP[v.agg].caption} of ${v.field}`;
  const suffix = SHOW_AS.find((s) => s.id === v.showAs)?.suffix ?? "";
  return base + suffix;
}
