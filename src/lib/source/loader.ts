import { confirm, runQuery } from "@beekeeperstudio/plugin";
import { fromQueryResult, fromRange, type LoadedData, type ResultLike } from "./dataset";
import {
  buildTableQuery,
  filtersToWhere,
  isReadOnly,
  isSelectLike,
  pickStatement,
  supportsSqlWrapping,
  trimStatement,
  wrapWithLimit,
  type TableFilter,
} from "./sql";

export interface SelectionSource {
  kind: "selection";
  columns: string[];
  rows: unknown[][];
  /** Where the selection came from, e.g. "query results". */
  origin: string;
}

export interface QuerySource {
  kind: "query";
  sql: string;
}

export interface TableSource {
  kind: "table";
  table: string;
  schema?: string | null;
  where: string;
}

export type SourceSpec = SelectionSource | QuerySource | TableSource;

/** Persistable form: selections are restored from the view context instead. */
export type StoredSource = QuerySource | TableSource | { kind: "selection" };

export interface LoadResult extends LoadedData {
  /** SQL that was executed, if any. */
  sql?: string;
  /** Something the user should know (e.g. limit applied client-side). */
  note?: string;
}

export function errorMessage(e: unknown): string {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  if (typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

const MISSING_OBJECT =
  /no such (table|column)|does not exist|doesn't exist|unknown (column|table)|invalid (object|column) name|invalid identifier|not found|undefined (table|column)|cannot resolve/i;

export function isMissingObjectError(e: unknown): boolean {
  return MISSING_OBJECT.test(errorMessage(e));
}

function lastResultWithFields(results: ResultLike[] | undefined): ResultLike {
  const withFields = (results ?? []).filter((r) => r && Array.isArray(r.fields) && r.fields.length > 0);
  if (!withFields.length) throw new Error("The query didn't return any columns.");
  return withFields[withFields.length - 1];
}

async function run(sql: string): Promise<ResultLike> {
  const response = await runQuery(sql);
  if (response?.error) throw response.error;
  return lastResultWithFields(response?.results as ResultLike[]);
}

function isInternalColumn(name: string): boolean {
  return name.endsWith("--bks") || name.startsWith("__beekeeper_internal");
}

export function loadSelection(source: SelectionSource, maxRows: number): LoadResult {
  const keep = source.columns.map((c, i) => (isInternalColumn(String(c ?? "")) ? -1 : i)).filter((i) => i >= 0);
  const columns = keep.map((i) => String(source.columns[i] ?? ""));
  const rows = keep.length === source.columns.length ? source.rows : source.rows.map((r) => keep.map((i) => r[i]));
  return fromRange(columns, rows, maxRows);
}

export async function loadQuery(source: QuerySource, maxRows: number, dialect: string): Promise<LoadResult> {
  const statement = trimStatement(source.sql.trim());
  if (!statement) throw new Error("Enter a query to pivot.");

  if (supportsSqlWrapping(dialect) && isSelectLike(statement)) {
    const wrapped = wrapWithLimit(dialect, statement, maxRows + 1);
    try {
      return { ...fromQueryResult(await run(wrapped), maxRows), sql: wrapped };
    } catch (e) {
      // Missing tables/columns fail the same way unwrapped, so don't offer to retry.
      if (!isReadOnly(statement) || isMissingObjectError(e)) throw e;
      const ok = await confirm(
        "Row limit couldn't be applied",
        `The database rejected the query when wrapped with a row limit:\n\n${errorMessage(e)}\n\nRun it as written and keep the first ${maxRows.toLocaleString()} rows?`,
        { confirmLabel: "Run as written", cancelLabel: "Cancel" }
      );
      if (!ok) throw e;
      const loaded = fromQueryResult(await run(statement), maxRows);
      return { ...loaded, sql: statement, note: "Row limit applied after the query ran." };
    }
  }

  if (supportsSqlWrapping(dialect) && !isReadOnly(statement)) {
    const ok = await confirm(
      "Run this statement?",
      "This doesn't look like a SELECT and may change data. Run it to build the pivot table?",
      { confirmLabel: "Run", cancelLabel: "Cancel" }
    );
    if (!ok) throw new Error("Cancelled.");
  }
  const loaded = fromQueryResult(await run(statement), maxRows);
  return { ...loaded, sql: statement, note: loaded.truncated ? "Row limit applied after the query ran." : undefined };
}

export async function loadTable(source: TableSource, maxRows: number, dialect: string): Promise<LoadResult> {
  const sql = buildTableQuery(dialect, {
    table: source.table,
    schema: source.schema,
    where: source.where,
    limit: maxRows + 1,
  });
  return { ...fromQueryResult(await run(sql), maxRows), sql };
}

export async function loadSource(source: SourceSpec, maxRows: number, dialect: string): Promise<LoadResult> {
  switch (source.kind) {
    case "selection":
      return loadSelection(source, maxRows);
    case "query":
      return loadQuery(source, maxRows, dialect);
    case "table":
      return loadTable(source, maxRows, dialect);
  }
}

export interface ContextSource {
  source: SourceSpec | null;
  notice?: string;
}

interface RawContext {
  command?: string;
  params?: Record<string, any>;
}

/** Work out the initial data source from how the view was opened. */
export function sourceFromContext(ctx: RawContext | null | undefined, dialect: string): ContextSource {
  const params = ctx?.params ?? {};
  switch (ctx?.command) {
    case "pivot-selection": {
      const range = params.activeRange ?? params.target;
      if (!range || !Array.isArray(range.columns) || !Array.isArray(range.value)) {
        return { source: null, notice: "No selection was passed to the plugin." };
      }
      const rows: unknown[][] = range.value;
      const source: SelectionSource = { kind: "selection", columns: range.columns, rows, origin: "selection" };
      const notice =
        rows.length <= 1
          ? "Only one row was selected. To pivot the whole result, select all cells first (click the top-left corner or press Ctrl/Cmd+A), then reopen."
          : undefined;
      return { source, notice };
    }
    case "pivot-query": {
      const text: string = params.selectedText || params.selectedQuery || params.text || params.tab?.data?.query || "";
      if (!text.trim()) return { source: null, notice: "The query tab is empty." };
      const { statement, count } = pickStatement(text);
      return {
        source: { kind: "query", sql: statement },
        notice: count > 1 ? `The tab has ${count} statements; using the last SELECT. Edit the query below to pick another.` : undefined,
      };
    }
    // Visualize menu in a status bar: rows (a selection or a whole query
    // result), or a table view with nothing selected. The grid only holds one
    // page of a table, so the table is read here with the pivot's row limit.
    case "pivot-results": {
      if (params.source === "table") {
        const entity = params.entity;
        if (!entity?.name) return { source: null, notice: "No table was passed to the plugin." };
        const filters: TableFilter[] = Array.isArray(params.filters) ? params.filters : [];
        const where = typeof params.where === "string" ? params.where : filtersToWhere(dialect, filters);
        return { source: { kind: "table", table: entity.name, schema: entity.schema ?? null, where } };
      }
      const range = params.activeRange;
      if (!range || !Array.isArray(range.columns) || !Array.isArray(range.value)) {
        return { source: null, notice: "No rows were passed to the plugin." };
      }
      const isResult = params.source === "result";
      const source: SelectionSource = {
        kind: "selection",
        columns: range.columns,
        rows: range.value,
        origin: isResult ? "query result" : "selection",
      };
      const notice =
        isResult && params.truncated
          ? "The query result stopped at its row limit, so the pivot only covers the rows it returned."
          : undefined;
      return { source, notice };
    }
    case "pivot-table": {
      const entity = params.entity ?? params.tab?.data?.table;
      const name = entity?.name;
      if (!name) return { source: null, notice: "No table was passed to the plugin." };
      const filters: TableFilter[] = Array.isArray(params.tab?.data?.filters) ? params.tab.data.filters : [];
      return {
        source: { kind: "table", table: name, schema: entity.schema ?? null, where: filtersToWhere(dialect, filters) },
      };
    }
    default:
      return { source: null };
  }
}

export function describeSource(source: SourceSpec | null): string {
  if (!source) return "No data";
  switch (source.kind) {
    case "selection":
      return "Selection";
    case "query":
      return "Query";
    case "table":
      return source.schema ? `${source.schema}.${source.table}` : source.table;
  }
}
