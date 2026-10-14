import type { StoredSource } from "./source/loader";
import type { AggregatorId, Dataset, PivotConfig, ValueField } from "./pivot/types";

export type Zone = "rows" | "cols" | "filters" | "values";
export type DragFrom = Zone | "fields";

export interface DragPayload {
  field: string | null;
  from: DragFrom;
  valueId?: string;
}

export const DRAG_MIME = "application/x-bks-pivot-field";

export const MAX_ROW_OPTIONS = [1_000, 5_000, 10_000, 50_000, 100_000];
export const DEFAULT_MAX_ROWS = 10_000;

export interface ViewState {
  version: 1;
  source: StoredSource | null;
  config: PivotConfig;
  maxRows: number;
  heatmap: boolean;
}

export function defaultConfig(): PivotConfig {
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
  };
}

let idCounter = 0;
export function newValueId(): string {
  idCounter++;
  return `v${Date.now().toString(36)}${idCounter}`;
}

export function defaultAggregator(dataset: Dataset | null, field: string | null): AggregatorId {
  if (field === null) return "count";
  const col = dataset?.columns.find((c) => c.name === field);
  return col?.type === "number" ? "sum" : "count";
}

export function makeValue(dataset: Dataset | null, field: string | null): ValueField {
  return { id: newValueId(), field, agg: defaultAggregator(dataset, field), showAs: "value" };
}

const AXES = ["rows", "cols", "filters"] as const;

/** Where a field currently sits among rows/cols/filters. */
export function axisOf(config: PivotConfig, field: string): (typeof AXES)[number] | null {
  for (const a of AXES) if (config[a].includes(field)) return a;
  return null;
}

/** Remove a field from a zone and drop its value filter when it leaves the pivot entirely. */
function removeFromAxes(config: PivotConfig, field: string) {
  for (const a of AXES) config[a] = config[a].filter((f) => f !== field);
}

/**
 * Apply a drop. Returns a new config; the input isn't modified.
 * `index` is the insert position within the target zone.
 */
export function applyDrop(
  input: PivotConfig,
  payload: DragPayload,
  target: Zone | "fields",
  index: number,
  dataset: Dataset | null
): PivotConfig {
  const config: PivotConfig = clone(input);
  const { field, from } = payload;

  if (target === "fields") {
    if (from === "values") config.values = config.values.filter((v) => v.id !== payload.valueId);
    else if (field !== null && from !== "fields") removeAndForget(config, field);
    return config;
  }

  if (target === "values") {
    if (from === "values") {
      const current = config.values.findIndex((v) => v.id === payload.valueId);
      if (current < 0) return config;
      const [moved] = config.values.splice(current, 1);
      config.values.splice(current < index ? index - 1 : index, 0, moved);
    } else {
      config.values.splice(index, 0, makeValue(dataset, field));
    }
    return config;
  }

  if (field === null) return config;
  if (from === "values") config.values = config.values.filter((v) => v.id !== payload.valueId);

  const list = config[target];
  const current = list.indexOf(field);
  let insertAt = index;
  if (current >= 0 && current < index) insertAt--;
  removeFromAxes(config, field);
  config[target].splice(Math.min(insertAt, config[target].length), 0, field);
  return config;
}

/** Remove a field from rows/cols/filters and clear its value filter. */
export function removeAndForget(config: PivotConfig, field: string) {
  removeFromAxes(config, field);
  const opts = config.fieldOptions[field];
  if (opts?.exclude) {
    config.fieldOptions[field] = { ...opts, exclude: [] };
  }
}

/** Pick a reasonable starting pivot for a dataset. */
export function suggestConfig(dataset: Dataset): PivotConfig {
  const config = defaultConfig();
  const sample = dataset.rows.slice(0, 2000);
  const cardinality = (i: number) => new Set(sample.map((r) => String(r[i]))).size;
  const candidates = dataset.columns
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.type === "string" || c.type === "boolean")
    .map(({ c, i }) => ({ name: c.name, n: cardinality(i) }))
    .filter(({ n }) => n >= 2 && n <= 50)
    .sort((a, b) => a.n - b.n);
  if (candidates.length) config.rows = [candidates[0].name];
  config.values = [makeValue(dataset, null)];
  return config;
}

/** Deep copy of plain JSON data (works on Vue proxies, unlike structuredClone). */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
