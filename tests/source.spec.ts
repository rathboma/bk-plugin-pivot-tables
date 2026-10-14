import { describe, expect, it } from "vitest";
import { buildDataset, detectType, fromQueryResult, fromRange, uniqueNames } from "../src/lib/source/dataset";
import {
  buildTableQuery,
  filtersToWhere,
  isReadOnly,
  isSelectLike,
  pickStatement,
  quoteIdent,
  splitStatements,
  wrapWithLimit,
} from "../src/lib/source/sql";

describe("dataset", () => {
  it("makes column names unique", () => {
    expect(uniqueNames(["id", "name", "id", "id", ""])).toEqual(["id", "name", "id (2)", "id (3)", "(unnamed)"]);
  });

  it("detects column types", () => {
    expect(detectType([1, "2", null, 3.5])).toBe("number");
    expect(detectType(["2024-01-01", "2024-02-01 10:00:00", null])).toBe("date");
    expect(detectType([true, false])).toBe("boolean");
    expect(detectType(["a", 1])).toBe("string");
    expect(detectType([null, null])).toBe("string");
    expect(detectType(["x"], "int4")).toBe("number");
    expect(detectType(["x"], "timestamp with time zone")).toBe("date");
    expect(detectType(["1 day"], "interval")).toBe("string");
  });

  it("reads query results keyed by field id or name", () => {
    const byId = fromQueryResult(
      {
        fields: [
          { id: "c0", name: "id", dataType: "int4" },
          { id: "c1", name: "id", dataType: "text" },
        ],
        rows: [
          { c0: 1, c1: "a" },
          { c0: 2, c1: "b" },
          { c0: 3, c1: "c" },
        ],
      },
      2
    );
    expect(byId.truncated).toBe(true);
    expect(byId.dataset.columns.map((c) => c.name)).toEqual(["id", "id (2)"]);
    expect(byId.dataset.rows).toEqual([
      [1, "a"],
      [2, "b"],
    ]);

    const byName = fromQueryResult({ fields: [{ name: "email" }], rows: [{ email: "x@y.z" }] }, 10);
    expect(byName.truncated).toBe(false);
    expect(byName.dataset.rows).toEqual([["x@y.z"]]);
  });

  it("reads grid selections", () => {
    const r = fromRange(["a", "b"], [[1, 2], [3, 4], [5, 6]], 2);
    expect(r.truncated).toBe(true);
    expect(r.dataset.rows).toHaveLength(2);
    expect(buildDataset(["a"], [[1]]).columns[0].type).toBe("number");
  });
});

describe("sql", () => {
  it("quotes identifiers per dialect", () => {
    expect(quoteIdent("postgresql", 'we"ird')).toBe('"we""ird"');
    expect(quoteIdent("mysql", "we`ird")).toBe("`we``ird`");
    expect(quoteIdent("sqlserver", "we]ird")).toBe("[we]]ird]");
  });

  it("builds table queries with limits", () => {
    expect(buildTableQuery("postgresql", { table: "orders", schema: "public", limit: 100 })).toBe(
      'SELECT * FROM "public"."orders" LIMIT 100'
    );
    expect(buildTableQuery("mysql", { table: "orders", where: "id > 5", limit: 10 })).toBe(
      "SELECT * FROM `orders` WHERE id > 5 LIMIT 10"
    );
    expect(buildTableQuery("sqlserver", { table: "orders", schema: "dbo", limit: 10 })).toBe(
      "SELECT TOP (10) * FROM [dbo].[orders]"
    );
    expect(buildTableQuery("oracle", { table: "ORDERS", where: "a = 1 OR b = 2", limit: 10 })).toBe(
      'SELECT * FROM "ORDERS" WHERE (a = 1 OR b = 2) AND ROWNUM <= 10'
    );
    expect(buildTableQuery("firebird", { table: "T", limit: 5 })).toBe('SELECT FIRST 5 * FROM "T"');
  });

  it("converts table view filters into a WHERE clause", () => {
    expect(
      filtersToWhere("postgresql", [
        { field: "status", type: "=", value: "it's" },
        { field: "total", type: ">=", value: "10", op: "AND" },
        { field: "region", type: "in", value: "east, west", op: "OR" },
        { field: "deleted_at", type: "is", op: "AND" },
        { field: "name", type: "not like", value: "%test%" },
        { field: "skip", type: "=", value: "" },
      ])
    ).toBe(
      `"status" = 'it''s' AND "total" >= '10' OR "region" IN ('east', 'west') AND "deleted_at" IS NULL AND "name" NOT LIKE '%test%'`
    );
    expect(filtersToWhere("mysql", [{ field: "path", type: "=", value: "a\\b" }])).toBe("`path` = 'a\\\\b'");
    expect(filtersToWhere("postgresql", [{ field: "x", type: "is not" }])).toBe('"x" IS NOT NULL');
    expect(filtersToWhere("postgresql", [{ field: "x", type: "in", value: ["1", "2"] }])).toBe(`"x" IN ('1', '2')`);
    expect(filtersToWhere("postgresql", [])).toBe("");
    expect(filtersToWhere("postgresql", null)).toBe("");
  });

  it("wraps queries with a row limit", () => {
    expect(wrapWithLimit("postgresql", "select * from t; ", 50)).toBe("SELECT * FROM (\nselect * from t\n) AS pivot_source LIMIT 50");
    expect(wrapWithLimit("sqlserver", "select * from t -- hi", 5)).toBe(
      "SELECT TOP (5) * FROM (\nselect * from t -- hi\n) AS pivot_source"
    );
    expect(wrapWithLimit("oracle", "select * from t", 5)).toBe("SELECT * FROM (\nselect * from t\n) pivot_source WHERE ROWNUM <= 5");
  });

  it("splits statements, ignoring semicolons in strings and comments", () => {
    const sql = `select ';' as a; -- c;omment
      select "x;y" from t /* ; */;
      create function f() returns int as $$ begin; return 1; end $$ language plpgsql;
      ;`;
    const parts = splitStatements(sql);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("select ';' as a");
    expect(parts[2]).toContain("$$ begin; return 1; end $$");
  });

  it("picks the last select-like statement", () => {
    expect(pickStatement("select 1;")).toEqual({ statement: "select 1", count: 1 });
    expect(pickStatement("update t set a=1; select * from t; delete from x")).toEqual({
      statement: "select * from t",
      count: 3,
    });
  });

  it("classifies statements", () => {
    expect(isSelectLike("  -- comment\n SELECT 1")).toBe(true);
    expect(isSelectLike("with x as (select 1) select * from x")).toBe(true);
    expect(isSelectLike("(select 1)")).toBe(true);
    expect(isSelectLike("delete from t")).toBe(false);
    expect(isReadOnly("select created_at, update_time from t")).toBe(true);
    expect(isReadOnly("with d as (delete from t returning *) select * from d")).toBe(false);
    expect(isReadOnly("show tables")).toBe(true);
    expect(isReadOnly("insert into t values (1)")).toBe(false);
  });
});

describe("loader helpers", async () => {
  // The loader imports the plugin SDK, which expects a browser window.
  (globalThis as any).window ??= { addEventListener() {}, parent: { postMessage() {} } };
  const { isMissingObjectError, sourceFromContext } = await import("../src/lib/source/loader");

  it("recognises missing object errors", () => {
    expect(isMissingObjectError(new Error("no such table: missing_table"))).toBe(true);
    expect(isMissingObjectError({ message: 'relation "x" does not exist' })).toBe(true);
    expect(isMissingObjectError("Invalid object name 'dbo.x'.")).toBe(true);
    expect(isMissingObjectError(new Error("syntax error at or near \")\""))).toBe(false);
  });

  it("derives sources from each menu entry point", () => {
    const sel = sourceFromContext(
      { command: "pivot-selection", params: { activeRange: { rows: [1, 2], columns: ["a"], value: [[1], [2]] } } },
      "postgresql"
    );
    expect(sel.source).toMatchObject({ kind: "selection", columns: ["a"] });
    expect(sel.notice).toBeUndefined();

    const one = sourceFromContext({ command: "pivot-selection", params: { activeRange: { rows: [1], columns: ["a"], value: [[1]] } } }, "postgresql");
    expect(one.notice).toMatch(/Only one row/);

    const editor = sourceFromContext({ command: "pivot-query", params: { text: "select 1; select 2", selectedQuery: "select 2" } }, "postgresql");
    expect(editor.source).toEqual({ kind: "query", sql: "select 2" });

    const tab = sourceFromContext({ command: "pivot-query", params: { tab: { data: { query: "select 1; select * from t;" } } } }, "postgresql");
    expect(tab.source).toEqual({ kind: "query", sql: "select * from t" });
    expect(tab.notice).toMatch(/2 statements/);

    const table = sourceFromContext(
      { command: "pivot-table", params: { tab: { data: { table: { name: "t", schema: "s" }, filters: [{ field: "a", type: "=", value: "1" }] } } } },
      "mysql"
    );
    expect(table.source).toEqual({ kind: "table", table: "t", schema: "s", where: "`a` = '1'" });

    const entity = sourceFromContext({ command: "pivot-table", params: { entity: { type: "table", name: "orders" } } }, "postgresql");
    expect(entity.source).toEqual({ kind: "table", table: "orders", schema: null, where: "" });

    expect(sourceFromContext({ command: "new-pivot" }, "postgresql").source).toBeNull();
    expect(sourceFromContext(null, "postgresql").source).toBeNull();
  });
});
