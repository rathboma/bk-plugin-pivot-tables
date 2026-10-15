import type { CellValue, ColumnType, DataColumn, Dataset } from "../pivot/types";
import { looksLikeDate, toNumber } from "../pivot/values";

export interface LoadedData {
  dataset: Dataset;
  /** Rows were dropped because of the row limit. */
  truncated: boolean;
}

export interface ResultField {
  id?: string;
  name: string;
  dataType?: string;
}

export interface ResultLike {
  fields: ResultField[];
  rows: Record<string, unknown>[] | unknown[][];
}

const NUMERIC_DB = /int|numeric|decimal|float|double|real|money|number|serial/i;
const DATE_DB = /date|time/i;
const BOOL_DB = /bool|bit\b/i;

/** Make column names unique: `id`, `id (2)`, `id (3)`... */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  const used = new Set<string>();
  return names.map((raw) => {
    const name = raw === "" ? "(unnamed)" : raw;
    let n = seen.get(name) ?? 0;
    let candidate = name;
    while (used.has(candidate)) {
      n++;
      candidate = `${name} (${n + 1})`;
    }
    seen.set(name, n);
    used.add(candidate);
    return candidate;
  });
}

/** Guess a column's type from its values (and database type, when known). */
export function detectType(values: CellValue[], dbType?: string): ColumnType {
  if (dbType) {
    if (DATE_DB.test(dbType) && !/interval/i.test(dbType)) return "date";
    if (BOOL_DB.test(dbType)) return "boolean";
    if (NUMERIC_DB.test(dbType) && !/point|interval/i.test(dbType)) return "number";
  }
  let seen = 0;
  let numbers = 0;
  let dates = 0;
  let bools = 0;
  for (const v of values) {
    if (v === null || v === undefined || v === "") continue;
    seen++;
    if (typeof v === "boolean") bools++;
    else if (v instanceof Date || (typeof v === "string" && looksLikeDate(v))) dates++;
    else if (!isNaN(toNumber(v))) numbers++;
    if (seen >= 500) break;
  }
  if (!seen) return "string";
  if (bools === seen) return "boolean";
  if (numbers === seen) return "number";
  if (dates === seen) return "date";
  return "string";
}

export function buildDataset(names: string[], rows: CellValue[][], dbTypes: (string | undefined)[] = []): Dataset {
  const unique = uniqueNames(names);
  const columns: DataColumn[] = unique.map((name, i) => ({
    name,
    type: detectType(
      rows.map((r) => r[i]),
      dbTypes[i]
    ),
    dbType: dbTypes[i],
  }));
  return { columns, rows };
}

/** Convert a `runQuery` result into a dataset, keeping at most `maxRows` rows. */
export function fromQueryResult(result: ResultLike, maxRows: number): LoadedData {
  const fields = result.fields ?? [];
  const source = result.rows ?? [];
  const truncated = source.length > maxRows;
  const slice = truncated ? source.slice(0, maxRows) : source;
  const rows: CellValue[][] = slice.map((row) => {
    if (Array.isArray(row)) return row;
    const obj = row as Record<string, unknown>;
    return fields.map((f) => (f.id !== undefined && f.id in obj ? obj[f.id] : obj[f.name]));
  });
  return {
    dataset: buildDataset(
      fields.map((f) => f.name),
      rows,
      fields.map((f) => f.dataType)
    ),
    truncated,
  };
}

/** Convert a grid selection (`activeRange`) into a dataset. */
export function fromRange(columns: string[], values: CellValue[][], maxRows: number): LoadedData {
  const truncated = values.length > maxRows;
  return {
    dataset: buildDataset(columns, truncated ? values.slice(0, maxRows) : values),
    truncated,
  };
}
