/** Dialect-aware SQL helpers for loading pivot data with a row limit. */

export interface TableFilter {
  field: string;
  type: string;
  value?: string | string[];
  op?: "AND" | "OR";
}

type QuoteStyle = "double" | "backtick" | "bracket";

const BACKTICK = new Set(["mysql", "mariadb", "bigquery", "tidb"]);
const BRACKET = new Set(["sqlserver"]);
/** Databases that don't speak SQL subqueries; queries run as written and are truncated client-side. */
const NO_WRAP = new Set(["mongodb", "redis", "cassandra", "surrealdb", "dynamodb", "bedrock"]);

function quoteStyle(dialect: string): QuoteStyle {
  if (BACKTICK.has(dialect)) return "backtick";
  if (BRACKET.has(dialect)) return "bracket";
  return "double";
}

export function quoteIdent(dialect: string, name: string): string {
  switch (quoteStyle(dialect)) {
    case "backtick":
      return "`" + name.replace(/`/g, "``") + "`";
    case "bracket":
      return "[" + name.replace(/]/g, "]]") + "]";
    default:
      return '"' + name.replace(/"/g, '""') + '"';
  }
}

export function quoteLiteral(dialect: string, value: string): string {
  let v = value.replace(/'/g, "''");
  if (dialect === "mysql" || dialect === "mariadb" || dialect === "tidb") v = v.replace(/\\/g, "\\\\");
  return `'${v}'`;
}

export function qualifiedTable(dialect: string, table: string, schema?: string | null): string {
  const t = quoteIdent(dialect, table);
  return schema ? `${quoteIdent(dialect, schema)}.${t}` : t;
}

const OPERATORS: Record<string, string> = {
  "=": "=",
  "!=": "<>",
  "<": "<",
  "<=": "<=",
  ">": ">",
  ">=": ">=",
  like: "LIKE",
  "not like": "NOT LIKE",
  ilike: "ILIKE",
  "not ilike": "NOT ILIKE",
};

function filterValues(value: TableFilter["value"]): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value === undefined || value === null) return [];
  return String(value)
    .split(/\s*,\s*/)
    .filter((v) => v !== "");
}

/** Single filter condition, mirroring how Beekeeper's table view applies filters. Null if unusable. */
export function filterToSql(dialect: string, f: TableFilter): string | null {
  if (!f || !f.field || !f.type) return null;
  const col = quoteIdent(dialect, f.field);
  const type = f.type.toLowerCase();
  if (type === "is") return `${col} IS NULL`;
  if (type === "is not") return `${col} IS NOT NULL`;
  if (type === "in") {
    const vals = filterValues(f.value);
    if (!vals.length) return null;
    return `${col} IN (${vals.map((v) => quoteLiteral(dialect, v)).join(", ")})`;
  }
  const op = OPERATORS[type];
  if (!op || f.value === undefined || f.value === null || f.value === "") return null;
  const value = Array.isArray(f.value) ? f.value.join(",") : String(f.value);
  return `${col} ${op} ${quoteLiteral(dialect, value)}`;
}

export function filtersToWhere(dialect: string, filters: TableFilter[] | null | undefined): string {
  if (!filters?.length) return "";
  let out = "";
  for (const f of filters) {
    const sql = filterToSql(dialect, f);
    if (!sql) continue;
    out = out ? `${out} ${f.op === "OR" ? "OR" : "AND"} ${sql}` : sql;
  }
  return out;
}

export function supportsSqlWrapping(dialect: string): boolean {
  return !NO_WRAP.has(dialect);
}

export interface TableQueryOptions {
  table: string;
  schema?: string | null;
  where?: string;
  limit: number;
}

/** `SELECT *` from a table with an optional WHERE clause and a row limit. */
export function buildTableQuery(dialect: string, opts: TableQueryOptions): string {
  const from = qualifiedTable(dialect, opts.table, opts.schema);
  const where = opts.where?.trim() ? ` WHERE ${opts.where.trim()}` : "";
  const n = Math.max(1, Math.floor(opts.limit));
  switch (dialect) {
    case "sqlserver":
      return `SELECT TOP (${n}) * FROM ${from}${where}`;
    case "oracle":
      // ROWNUM works on every Oracle version (FETCH FIRST needs 12c+).
      return `SELECT * FROM ${from} WHERE ${opts.where?.trim() ? `(${opts.where.trim()}) AND ` : ""}ROWNUM <= ${n}`;
    case "firebird":
      return `SELECT FIRST ${n} * FROM ${from}${where}`;
    default:
      return `SELECT * FROM ${from}${where} LIMIT ${n}`;
  }
}

/** Remove trailing semicolons and whitespace. */
export function trimStatement(sql: string): string {
  return sql.replace(/[\s;]+$/g, "");
}

/**
 * Wrap a SELECT so the database only returns `limit` rows. The newlines keep
 * a trailing `-- comment` in the user's query from swallowing the wrapper.
 */
export function wrapWithLimit(dialect: string, sql: string, limit: number): string {
  const inner = trimStatement(sql);
  const n = Math.max(1, Math.floor(limit));
  switch (dialect) {
    case "sqlserver":
      return `SELECT TOP (${n}) * FROM (\n${inner}\n) AS pivot_source`;
    case "oracle":
      return `SELECT * FROM (\n${inner}\n) pivot_source WHERE ROWNUM <= ${n}`;
    case "firebird":
      return `SELECT FIRST ${n} * FROM (\n${inner}\n) pivot_source`;
    default:
      return `SELECT * FROM (\n${inner}\n) AS pivot_source LIMIT ${n}`;
  }
}

/**
 * Split SQL into statements on semicolons that aren't inside strings,
 * quoted identifiers, comments or Postgres dollar-quoted bodies.
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let start = 0;
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? n : end + 1;
    } else if (ch === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
    } else if (ch === "'" || ch === '"' || ch === "`") {
      i++;
      while (i < n) {
        if (sql[i] === ch) {
          if (sql[i + 1] === ch) i += 2;
          else break;
        } else if (sql[i] === "\\" && ch === "'") i += 2;
        else i++;
      }
      i++;
    } else if (ch === "$") {
      const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (m) {
        const end = sql.indexOf(m[0], i + m[0].length);
        i = end === -1 ? n : end + m[0].length;
      } else i++;
    } else if (ch === ";") {
      out.push(sql.slice(start, i));
      start = i + 1;
      i++;
    } else i++;
  }
  out.push(sql.slice(start));
  return out.map((s) => s.trim()).filter((s) => stripComments(s).trim() !== "");
}

export function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

/** Statements that read data and can be wrapped in a subquery. */
export function isSelectLike(sql: string): boolean {
  const head = stripComments(sql).trim().replace(/^\(+\s*/, "").slice(0, 12).toLowerCase();
  return /^(select|with|values|table)\b/.test(head);
}

/** Statements that return rows without modifying anything (for running unwrapped). */
export function isReadOnly(sql: string): boolean {
  if (isSelectLike(sql)) {
    const body = stripComments(sql).toLowerCase();
    return !/\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke)\b/.test(body);
  }
  const head = stripComments(sql).trim().slice(0, 10).toLowerCase();
  return /^(show|explain|describe|desc|pragma)\b/.test(head);
}

/** Pick the statement to pivot: the last select-like statement, or the whole text. */
export function pickStatement(sql: string): { statement: string; count: number } {
  const statements = splitStatements(sql);
  if (statements.length <= 1) return { statement: trimStatement(sql.trim()), count: statements.length };
  const selects = statements.filter(isSelectLike);
  return { statement: (selects.length ? selects[selects.length - 1] : statements[statements.length - 1]).trim(), count: statements.length };
}
