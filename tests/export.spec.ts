import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { computePivot } from "../src/lib/pivot/engine";
import { buildGrid } from "../src/lib/pivot/grid";
import type { PivotConfig } from "../src/lib/pivot/types";
import { toPdf, needsUnicodeFont } from "../src/lib/export/pdf";
import { toCsv, toHtmlDocument, toJson, toMarkdown, toTsv } from "../src/lib/export/text";
import { sheetName, toXlsx } from "../src/lib/export/xlsx";
import { arrayBufferToBase64, safeFileName } from "../src/lib/export/util";
import { config, sales, sum } from "./fixtures";

const grid = (c: Partial<PivotConfig>) => buildGrid(computePivot(sales, config(c)));
const crosstab = () => grid({ rows: ["region", "product"], cols: ["year"], values: [sum("amount")], subtotals: true });
const meta = { title: "Sales pivot", subtitle: "sales · 6 rows" };

describe("text exports", () => {
  it("writes CSV with repeated labels and raw numbers", () => {
    const g = grid({ rows: ["region"], cols: ["year"], values: [sum("amount", { showAs: "pctGrandTotal" })] });
    expect(toCsv(g).split("\r\n")).toEqual([
      "region,2022,2023,Total",
      "East,0.375,0.375,0.75",
      "West,0.0625,0.1875,0.25",
      "Total,0.4375,0.5625,1",
      "",
    ]);
    const sub = toCsv(crosstab()).split("\r\n");
    expect(sub[2]).toBe("East,B,20,,20");
    expect(sub[3]).toBe("East Total,,30,30,60");
  });

  it("escapes CSV values", () => {
    const ds = { columns: [{ name: 'na,"me"', type: "string" as const }], rows: [["a,b"], ['say "hi"']] };
    const csv = toCsv(buildGrid(computePivot(ds, config({ rows: ['na,"me"'] }))));
    expect(csv.split("\r\n").slice(0, 3)).toEqual(['"na,""me""",Count', '"a,b",1', '"say ""hi""",1']);
  });

  it("writes TSV with percentages kept as percentages", () => {
    const g = grid({ rows: ["region"], values: [sum("amount", { showAs: "pctGrandTotal" })] });
    expect(toTsv(g).split("\n")).toEqual(["region\tSum of amount (% of total)", "East\t75%", "West\t25%", "Total\t100%"]);
  });

  it("writes Markdown with blank repeated labels and bold totals", () => {
    const md = toMarkdown(crosstab()).trim().split("\n");
    expect(md[0]).toBe("| region | product | 2022 | 2023 | Total |");
    expect(md[1]).toBe("| :--- | :--- | ---: | ---: | ---: |");
    expect(md[2]).toBe("| East | A | 10 | 30 | 40 |");
    expect(md[3]).toBe("|  | B | 20 |  | 20 |");
    expect(md[4]).toBe("| **East Total** |  | 30 | 30 | 60 |");
    expect(md[md.length - 1]).toBe("| **Total** |  | 35 | 45 | 80 |");
  });

  it("escapes pipes in Markdown", () => {
    const ds = { columns: [{ name: "a|b", type: "string" as const }], rows: [["x|y"]] };
    const md = toMarkdown(buildGrid(computePivot(ds, config({ rows: ["a|b"] }))));
    expect(md).toContain("| a\\|b | Count |");
    expect(md).toContain("| x\\|y | 1 |");
  });

  it("writes JSON records", () => {
    const records = JSON.parse(toJson(grid({ rows: ["region"], cols: ["year"], values: [sum("amount")] })));
    expect(records[0]).toEqual({ region: "East", "2022": 30, "2023": 30, Total: 60 });
  });

  it("writes an HTML document with spans and escaping", () => {
    const html = toHtmlDocument(crosstab(), { title: "<Sales>" });
    expect(html).toContain("<title>&lt;Sales&gt;</title>");
    expect(html).toContain('<th rowspan="2" class="rowHeader">East</th>');
    expect(html).toContain('<th colspan="2" class="rowHeader total-sub">East Total</th>');
  });
});

describe("xlsx export", () => {
  it("writes merged headers, numbers and formats", async () => {
    const buf = await toXlsx(crosstab(), meta, { dataset: sales });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet("Pivot")!;
    expect(ws.getCell("A1").value).toBe("Sales pivot");
    expect(ws.getCell("A2").value).toBe("sales · 6 rows");
    // Table starts on row 4: header (2 rows) then body.
    expect(ws.getCell("A4").value).toBe("year");
    expect(ws.getCell("C4").value).toBe("2022");
    expect(ws.getCell("A6").value).toBe("East");
    expect(ws.getCell("C6").value).toBe(10);
    expect(ws.getCell("C6").numFmt).toBe("#,##0");
    expect(ws.getCell("A8").value).toBe("East Total");
    expect(ws.getCell("A8").font?.bold).toBe(true);
    // Year header spans the two row label columns; East spans two rows.
    expect(ws.getCell("B4").isMerged).toBe(true);
    expect(ws.getCell("A7").master.address).toBe("A6");
    expect(ws.views[0]).toMatchObject({ state: "frozen", xSplit: 2, ySplit: 5 });

    const data = wb.getWorksheet("Data")!;
    expect(data.getRow(1).values).toEqual([undefined, "region", "product", "year", "amount", "sold_at"]);
    expect(data.rowCount).toBe(7);
  });

  it("formats percentages", async () => {
    const g = grid({ rows: ["region"], values: [sum("amount", { showAs: "pctGrandTotal" })] });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await toXlsx(g, meta));
    const cell = wb.getWorksheet("Pivot")!.getCell("B5");
    expect(cell.value).toBe(0.75);
    expect(cell.numFmt).toBe("0.0%");
  });

  it("cleans sheet names", () => {
    expect(sheetName("a/b:c*d?[e]")).toBe("a b c d  e");
    expect(sheetName("x".repeat(40))).toHaveLength(31);
  });
});

describe("pdf export", () => {
  it("produces a PDF document", async () => {
    const buf = await toPdf(crosstab(), meta);
    const head = new TextDecoder().decode(new Uint8Array(buf).slice(0, 5));
    expect(head).toBe("%PDF-");
    expect(buf.byteLength).toBeGreaterThan(1000);
  });

  it("splits very wide pivots across pages", async () => {
    const rows: unknown[][] = [];
    for (let i = 0; i < 40; i++) rows.push([`row ${i % 5}`, `column ${String(i).padStart(2, "0")}`, i]);
    const ds = {
      columns: [
        { name: "r", type: "string" as const },
        { name: "c", type: "string" as const },
        { name: "n", type: "number" as const },
      ],
      rows,
    };
    const g = buildGrid(computePivot(ds, config({ rows: ["r"], cols: ["c"], values: [sum("n")] })));
    const pdf = new TextDecoder("latin1").decode(new Uint8Array(await toPdf(g, meta)));
    const pages = pdf.match(/\/Type \/Page\b/g) ?? [];
    expect(pages.length).toBeGreaterThan(1);
  });

  it("detects text that needs a Unicode font", () => {
    expect(needsUnicodeFont(["Café", "naïve – “quotes” €"])).toBe(false);
    expect(needsUnicodeFont(["Москва"])).toBe(true);
  });
});

describe("helpers", () => {
  it("base64 encodes binary data", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    expect(arrayBufferToBase64(bytes.buffer)).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("makes safe file names", () => {
    expect(safeFileName("Pivot: orders / 2024?")).toBe("Pivot-orders-2024");
    expect(safeFileName("///")).toBe("pivot");
  });
});
