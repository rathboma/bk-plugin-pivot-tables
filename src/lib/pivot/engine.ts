import { createAggregator, type Aggregator } from "./aggregators";
import type { AggValue, Dataset, PivotConfig, SortOrder, ValueField } from "./types";
import { compareLabels, groupedLabel, toNumber } from "./values";

const LEVEL_SEP = "\u0000";
const AXIS_SEP = "\u0001";

export const COUNT_ROWS: ValueField = { id: "__count__", field: null, agg: "count", showAs: "value" };

export interface PivotResult {
  /** Config with references to unknown fields removed. */
  config: PivotConfig;
  /** Value fields actually computed (defaults to a row count). */
  values: ValueField[];
  /** Sorted, full-length row keys. */
  rowKeys: string[][];
  /** Sorted, full-length column keys. */
  colKeys: string[][];
  /**
   * Aggregated value for a row key and column key. Either key may be a
   * prefix: `[]` is the total across that axis, a shorter key is a subtotal.
   */
  get(rowKey: string[], colKey: string[], valueIndex: number): AggValue;
  totalRecords: number;
  matchedRecords: number;
  /** Per value field: results are always whole numbers (used to pick decimals). */
  integerValues: boolean[];
}

/** Drop fields the dataset doesn't have (e.g. restored state for a changed query). */
export function sanitizeConfig(config: PivotConfig, dataset: Dataset): PivotConfig {
  const names = new Set(dataset.columns.map((c) => c.name));
  const keep = (fields: string[]) => fields.filter((f) => names.has(f));
  return {
    ...config,
    rows: keep(config.rows),
    cols: keep(config.cols),
    filters: keep(config.filters),
    values: config.values.filter((v) => v.field === null || names.has(v.field)),
  };
}

export function computePivot(dataset: Dataset, rawConfig: PivotConfig): PivotResult {
  const config = sanitizeConfig(rawConfig, dataset);
  const values = config.values.length ? config.values : [COUNT_ROWS];
  const index = new Map(dataset.columns.map((c, i) => [c.name, i]));
  const opts = (f: string) => config.fieldOptions[f] ?? {};

  const rowIdx = config.rows.map((f) => index.get(f)!);
  const colIdx = config.cols.map((f) => index.get(f)!);
  const rowGroups = config.rows.map((f) => opts(f).dateGroup);
  const colGroups = config.cols.map((f) => opts(f).dateGroup);
  const valueIdx = values.map((v) => (v.field === null ? -1 : index.get(v.field)!));

  const filterFields = [...new Set([...config.rows, ...config.cols, ...config.filters])]
    .map((f) => ({ idx: index.get(f)!, group: opts(f).dateGroup, exclude: new Set(opts(f).exclude ?? []) }))
    .filter((f) => f.exclude.size > 0);

  const nr = rowIdx.length;
  const nc = colIdx.length;
  const aggs = new Map<string, Aggregator[]>();
  const rowKeyMap = new Map<string, string[]>();
  const colKeyMap = new Map<string, string[]>();
  // Custom orderings (e.g. month names), per axis level.
  const rowSort: Map<string, number>[] = config.rows.map(() => new Map());
  const colSort: Map<string, number>[] = config.cols.map(() => new Map());

  let matched = 0;
  const rLabels: string[] = new Array(nr);
  const cLabels: string[] = new Array(nc);
  const rPrefix: string[] = new Array(nr + 1);
  const cPrefix: string[] = new Array(nc + 1);

  for (const record of dataset.rows) {
    let skip = false;
    for (const f of filterFields) {
      if (f.exclude.has(groupedLabel(record[f.idx], f.group).label)) {
        skip = true;
        break;
      }
    }
    if (skip) continue;
    matched++;

    for (let i = 0; i < nr; i++) {
      const g = groupedLabel(record[rowIdx[i]], rowGroups[i]);
      rLabels[i] = g.label;
      if (g.sort !== undefined) rowSort[i].set(g.label, g.sort);
    }
    for (let i = 0; i < nc; i++) {
      const g = groupedLabel(record[colIdx[i]], colGroups[i]);
      cLabels[i] = g.label;
      if (g.sort !== undefined) colSort[i].set(g.label, g.sort);
    }

    rPrefix[0] = "";
    for (let i = 0; i < nr; i++) rPrefix[i + 1] = i === 0 ? rLabels[0] : rPrefix[i] + LEVEL_SEP + rLabels[i];
    cPrefix[0] = "";
    for (let i = 0; i < nc; i++) cPrefix[i + 1] = i === 0 ? cLabels[0] : cPrefix[i] + LEVEL_SEP + cLabels[i];

    if (nr && !rowKeyMap.has(rPrefix[nr])) rowKeyMap.set(rPrefix[nr], rLabels.slice());
    if (nc && !colKeyMap.has(cPrefix[nc])) colKeyMap.set(cPrefix[nc], cLabels.slice());

    for (let ri = 0; ri <= nr; ri++) {
      for (let ci = 0; ci <= nc; ci++) {
        const key = rPrefix[ri] + AXIS_SEP + cPrefix[ci];
        let cell = aggs.get(key);
        if (!cell) {
          cell = values.map((v) => createAggregator(v.agg));
          aggs.set(key, cell);
        }
        for (let vi = 0; vi < values.length; vi++) {
          cell[vi].push(valueIdx[vi] === -1 ? 1 : record[valueIdx[vi]]);
        }
      }
    }
  }

  const cache = new Map<string, AggValue[]>();
  const get = (rowKey: string[], colKey: string[], vi: number): AggValue => {
    const key = rowKey.join(LEVEL_SEP) + AXIS_SEP + colKey.join(LEVEL_SEP);
    let vals = cache.get(key);
    if (!vals) {
      const cell = aggs.get(key);
      vals = cell ? cell.map((a) => a.value()) : values.map(() => null);
      cache.set(key, vals);
    }
    return vals[vi] ?? null;
  };

  const rowKeys = sortKeys(
    [...rowKeyMap.values()],
    config.rows.map((f) => opts(f).sort ?? "asc"),
    rowSort,
    (prefix) => get(prefix, [], 0)
  );
  const colKeys = sortKeys(
    [...colKeyMap.values()],
    config.cols.map((f) => opts(f).sort ?? "asc"),
    colSort,
    (prefix) => get([], prefix, 0)
  );

  return {
    config,
    values,
    rowKeys,
    colKeys,
    get,
    totalRecords: dataset.rows.length,
    matchedRecords: matched,
    integerValues: values.map((v, vi) => producesIntegers(dataset, v, valueIdx[vi])),
  };
}

const INTEGER_PRESERVING = new Set(["sum", "min", "max", "first", "last"]);

function producesIntegers(dataset: Dataset, v: ValueField, idx: number): boolean {
  if (v.agg === "count" || v.agg === "countDistinct") return true;
  if (!INTEGER_PRESERVING.has(v.agg) || idx < 0) return false;
  for (const row of dataset.rows) {
    const x = toNumber(row[idx]);
    if (!isNaN(x) && !Number.isInteger(x)) return false;
  }
  return true;
}

function compareAggValues(a: AggValue, b: AggValue): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const na = typeof a === "number" ? a : toNumber(a);
  const nb = typeof b === "number" ? b : toNumber(b);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  return compareLabels(String(a), String(b));
}

function sortKeys(
  keys: string[][],
  orders: SortOrder[],
  custom: Map<string, number>[],
  totalFor: (prefix: string[]) => AggValue
): string[][] {
  return keys.sort((a, b) => {
    for (let i = 0; i < orders.length; i++) {
      if (a[i] === b[i]) continue;
      const order = orders[i];
      if (order === "valueAsc" || order === "valueDesc") {
        const cmp = compareAggValues(totalFor(a.slice(0, i + 1)), totalFor(b.slice(0, i + 1)));
        if (cmp !== 0) return order === "valueAsc" ? cmp : -cmp;
        // Ties fall back to label order.
        return compareLabels(a[i], b[i]);
      }
      const sa = custom[i].get(a[i]);
      const sb = custom[i].get(b[i]);
      const cmp = sa !== undefined && sb !== undefined ? sa - sb : compareLabels(a[i], b[i]);
      return order === "desc" ? -cmp : cmp;
    }
    return 0;
  });
}

export interface DistinctValue {
  label: string;
  count: number;
}

/** Distinct labels for a field (under its date grouping), for the filter picker. */
export function distinctValues(dataset: Dataset, field: string, config: PivotConfig): DistinctValue[] {
  const idx = dataset.columns.findIndex((c) => c.name === field);
  if (idx < 0) return [];
  const group = config.fieldOptions[field]?.dateGroup;
  const counts = new Map<string, number>();
  const sortIdx = new Map<string, number>();
  for (const row of dataset.rows) {
    const g = groupedLabel(row[idx], group);
    counts.set(g.label, (counts.get(g.label) ?? 0) + 1);
    if (g.sort !== undefined) sortIdx.set(g.label, g.sort);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => {
      const sa = sortIdx.get(a.label);
      const sb = sortIdx.get(b.label);
      return sa !== undefined && sb !== undefined ? sa - sb : compareLabels(a.label, b.label);
    });
}
