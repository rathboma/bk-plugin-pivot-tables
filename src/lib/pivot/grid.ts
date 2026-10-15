import { AGGREGATOR_MAP } from "./aggregators";
import type { PivotResult } from "./engine";
import { fieldCaption, formatNumber, resolveDigits, valueCaption } from "./format";
import type { AggValue, PivotConfig, ValueField } from "./types";

export type CellKind = "axisLabel" | "colHeader" | "rowHeader" | "valueHeader" | "data";

export interface GridCell {
  /** Display text. Covered cells carry their owner's label when it's a repeated label, else "". */
  text: string;
  /** Raw value for exports. Percentages are fractions (0.25 = 25%). */
  value: AggValue;
  kind: CellKind;
  total?: "sub" | "grand";
  percent?: boolean;
  /** Fraction digits used for `text`, so exports can match. */
  digits?: number;
  colSpan: number;
  rowSpan: number;
  /** Covered by another cell's span; renderers that support spans skip it. */
  hidden?: boolean;
  /** Index into `values` for data and value header cells. */
  valueIndex?: number;
}

/** `all` is the single entry of an axis with no fields. */
export type EntryType = "leaf" | "sub" | "grand" | "all";

export interface AxisEntry {
  key: string[];
  type: EntryType;
  /** For subtotals: the axis level that's being totalled. */
  level: number;
}

export interface PivotGrid {
  result: PivotResult;
  config: PivotConfig;
  values: ValueField[];
  header: GridCell[][];
  bodyRowCount: number;
  /** Cells of body row `i`; `colLimit` stops building cells at that column (for rendering). */
  bodyRow(i: number, colLimit?: number): GridCell[];
  width: number;
  headerRows: number;
  rowHeaderCols: number;
  rowEntries: AxisEntry[];
  colEntries: AxisEntry[];
}

function samePrefix(a: string[], b: string[], len: number): boolean {
  for (let i = 0; i < len; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function axisEntries(keys: string[][], depth: number, subtotals: boolean, grand: boolean): AxisEntry[] {
  if (depth === 0) return [{ key: [], type: "all", level: -1 }];
  const out: AxisEntry[] = [];
  for (let k = 0; k < keys.length; k++) {
    const key = keys[k];
    out.push({ key, type: "leaf", level: depth - 1 });
    if (subtotals) {
      const next = keys[k + 1];
      for (let l = depth - 2; l >= 0; l--) {
        if (!next || !samePrefix(key, next, l + 1)) out.push({ key: key.slice(0, l + 1), type: "sub", level: l });
      }
    }
  }
  if (grand) out.push({ key: [], type: "grand", level: -1 });
  return out;
}

/** Is the entry grouped under a label at `level` (as opposed to being a total at or above it)? */
function underLabel(e: AxisEntry, level: number): boolean {
  return e.type === "leaf" || (e.type === "sub" && e.level > level);
}

/**
 * For each level, how many consecutive entries share the label at that level.
 * 0 means covered by the entry above/left; -1 means the level isn't a label for this entry.
 */
function labelSpans(entries: AxisEntry[], depth: number): Int32Array[] {
  const spans: Int32Array[] = [];
  for (let j = 0; j < depth; j++) {
    const s = new Int32Array(entries.length).fill(-1);
    let e = 0;
    while (e < entries.length) {
      if (!underLabel(entries[e], j)) {
        e++;
        continue;
      }
      const start = e;
      const key = entries[e].key;
      e++;
      while (e < entries.length && underLabel(entries[e], j) && samePrefix(entries[e].key, key, j + 1)) {
        s[e] = 0;
        e++;
      }
      s[start] = e - start;
    }
    spans.push(s);
  }
  return spans;
}

const totalOf = (e: AxisEntry): GridCell["total"] => (e.type === "sub" || e.type === "grand" ? e.type : undefined);

const cell = (c: Partial<GridCell> & Pick<GridCell, "kind">): GridCell => ({
  text: "",
  value: null,
  colSpan: 1,
  rowSpan: 1,
  ...c,
});

const covered = (kind: GridCell["kind"], text = "", extra: Partial<GridCell> = {}): GridCell =>
  cell({ kind, text, value: text || null, hidden: true, ...extra });

export function buildGrid(result: PivotResult): PivotGrid {
  const { config, values } = result;
  const nr = config.rows.length;
  const nc = config.cols.length;
  const V = values.length;
  const valuesOnRows = config.valuesOn === "rows";

  const rowEntries = axisEntries(result.rowKeys, nr, config.subtotals && nr > 1, config.colTotals && nr > 0);
  const colEntries = axisEntries(result.colKeys, nc, config.subtotals && nc > 1, config.rowTotals && nc > 0);

  const labelCols = Math.max(nr, valuesOnRows ? 0 : 1);
  const R = labelCols + (valuesOnRows ? 1 : 0);
  const colMult = valuesOnRows ? 1 : V;
  const rowMult = valuesOnRows ? V : 1;
  const width = R + colEntries.length * colMult;
  const H = nc + 1;

  const colSpans = labelSpans(colEntries, nc);
  const rowSpans = labelSpans(rowEntries, nr);

  // ---------- header ----------
  const header: GridCell[][] = [];
  for (let i = 0; i < nc; i++) {
    const row: GridCell[] = [cell({ kind: "axisLabel", text: fieldCaption(config.cols[i], config), colSpan: R })];
    for (let j = 1; j < R; j++) row.push(covered("axisLabel"));
    colEntries.forEach((e, ei) => {
      const total = totalOf(e);
      if (e.type === "grand") {
        if (i === 0) row.push(cell({ kind: "colHeader", text: "Total", value: "Total", total, colSpan: colMult, rowSpan: nc }));
        else row.push(covered("colHeader", "", { total }));
        for (let k = 1; k < colMult; k++) row.push(covered("colHeader", i === 0 ? "Total" : "", { total }));
        return;
      }
      if (e.type === "sub" && e.level === i) {
        const text = `${e.key[i]} Total`;
        row.push(cell({ kind: "colHeader", text, value: text, total, colSpan: colMult, rowSpan: nc - i }));
        for (let k = 1; k < colMult; k++) row.push(covered("colHeader", text, { total }));
        return;
      }
      if (e.type === "sub" && e.level < i) {
        for (let k = 0; k < colMult; k++) row.push(covered("colHeader", "", { total }));
        return;
      }
      const span = colSpans[i][ei];
      const label = e.key[i];
      if (span > 0) {
        row.push(cell({ kind: "colHeader", text: label, value: label, colSpan: span * colMult }));
        for (let k = 1; k < colMult; k++) row.push(covered("colHeader", label));
      } else {
        for (let k = 0; k < colMult; k++) row.push(covered("colHeader", label));
      }
    });
    header.push(row);
  }

  // Last header row: row field names in the corner, value captions above data.
  {
    const row: GridCell[] = [];
    for (let j = 0; j < labelCols; j++) {
      const text = j < nr ? fieldCaption(config.rows[j], config) : "";
      row.push(cell({ kind: "axisLabel", text, value: text || null }));
    }
    if (valuesOnRows) row.push(cell({ kind: "axisLabel", text: "Values", value: "Values" }));
    colEntries.forEach((e) => {
      const total = totalOf(e);
      if (valuesOnRows) {
        const text = nc === 0 ? "Value" : "";
        row.push(cell({ kind: "valueHeader", text, value: text || null, total }));
      } else {
        values.forEach((v, vi) => {
          const text = valueCaption(v);
          row.push(cell({ kind: "valueHeader", text, value: text, total, valueIndex: vi }));
        });
      }
    });
    header.push(row);
  }

  // ---------- body ----------
  const percentFor = (v: ValueField) => v.showAs !== "value" && AGGREGATOR_MAP[v.agg].numericResult;

  const dataCell = (re: AxisEntry, ce: AxisEntry, vi: number): GridCell => {
    const v = values[vi];
    let raw = result.get(re.key, ce.key, vi);
    const percent = percentFor(v);
    if (percent && typeof raw === "number") {
      const denom =
        v.showAs === "pctGrandTotal"
          ? result.get([], [], vi)
          : v.showAs === "pctRowTotal"
            ? result.get(re.key, [], vi)
            : result.get([], ce.key, vi);
      raw = typeof denom === "number" && denom !== 0 ? raw / denom : null;
    }
    const total = re.type === "grand" || ce.type === "grand" ? "grand" : re.type === "sub" || ce.type === "sub" ? "sub" : undefined;
    let text = "";
    let digits: number | undefined;
    if (typeof raw === "number") {
      digits = resolveDigits(config.decimals, percent, result.integerValues[vi] && !percent);
      text = formatNumber(raw, digits, percent);
    } else if (raw !== null) text = raw;
    return cell({ kind: "data", text, value: raw, total, percent: percent && typeof raw === "number", digits, valueIndex: vi });
  };

  const bodyRow = (i: number, colLimit = width): GridCell[] => {
    const ei = Math.floor(i / rowMult);
    const vi = valuesOnRows ? i % V : 0;
    const first = valuesOnRows ? vi === 0 : true;
    const e = rowEntries[ei];
    const total = totalOf(e);
    const row: GridCell[] = [];

    // Row labels
    if (nr === 0) {
      if (!valuesOnRows) row.push(cell({ kind: "rowHeader", text: "Total", value: "Total" }));
    } else if (e.type === "grand") {
      if (first) row.push(cell({ kind: "rowHeader", text: "Total", value: "Total", total, colSpan: labelCols, rowSpan: rowMult }));
      else row.push(covered("rowHeader", "", { total }));
      for (let j = 1; j < labelCols; j++) row.push(covered("rowHeader", "", { total }));
    } else {
      for (let j = 0; j < nr; j++) {
        if (e.type === "sub" && j === e.level) {
          const text = `${e.key[j]} Total`;
          if (first) row.push(cell({ kind: "rowHeader", text, value: text, total, colSpan: nr - j, rowSpan: rowMult }));
          else row.push(covered("rowHeader", "", { total }));
          continue;
        }
        if (e.type === "sub" && j > e.level) {
          row.push(covered("rowHeader", "", { total }));
          continue;
        }
        const span = rowSpans[j][ei];
        const label = e.key[j];
        if (span > 0 && first) row.push(cell({ kind: "rowHeader", text: label, value: label, rowSpan: span * rowMult, total }));
        else row.push(covered("rowHeader", label, { total }));
      }
    }
    if (valuesOnRows) {
      const text = valueCaption(values[vi]);
      row.push(cell({ kind: "valueHeader", text, value: text, total, valueIndex: vi }));
    }

    // Data
    for (const ce of colEntries) {
      if (row.length >= colLimit) break;
      if (valuesOnRows) row.push(dataCell(e, ce, vi));
      else for (let v = 0; v < V && row.length < colLimit; v++) row.push(dataCell(e, ce, v));
    }
    return row;
  };

  return {
    result,
    config,
    values,
    header,
    bodyRowCount: rowEntries.length * rowMult,
    bodyRow,
    width,
    headerRows: H,
    rowHeaderCols: R,
    rowEntries,
    colEntries,
  };
}

/** One header label per column, joining multi-level headers (for CSV, Markdown, etc.). */
export function flatHeader(grid: PivotGrid, sep = " / "): string[] {
  const out: string[] = [];
  const singleValue = grid.values.length === 1;
  for (let c = 0; c < grid.width; c++) {
    if (c < grid.rowHeaderCols) {
      out.push(grid.header[grid.headerRows - 1][c].text);
      continue;
    }
    const parts: string[] = [];
    for (let r = 0; r < grid.headerRows; r++) {
      const h = grid.header[r][c];
      const isValueRow = r === grid.headerRows - 1;
      if (isValueRow && singleValue && parts.length) continue;
      if (h.text) parts.push(h.text);
    }
    out.push(parts.join(sep));
  }
  return out;
}

export function* bodyRows(grid: PivotGrid): Generator<GridCell[]> {
  for (let i = 0; i < grid.bodyRowCount; i++) yield grid.bodyRow(i);
}
