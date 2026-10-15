import type { Borders, Fill, Worksheet } from "exceljs";
import { excelNumFmt } from "../pivot/format";
import { bodyRows, type GridCell, type PivotGrid } from "../pivot/grid";
import type { Dataset } from "../pivot/types";
import type { ExportMeta } from "./text";

const BORDER_COLOR = { argb: "FFD0D7DE" };
const border: Partial<Borders> = {
  top: { style: "thin", color: BORDER_COLOR },
  left: { style: "thin", color: BORDER_COLOR },
  bottom: { style: "thin", color: BORDER_COLOR },
  right: { style: "thin", color: BORDER_COLOR },
};
const fill = (argb: string): Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const HEADER_FILL = fill("FFF3F4F6");
const LABEL_FILL = fill("FFFAFBFC");
const SUB_FILL = fill("FFF6F8FA");
const GRAND_FILL = fill("FFEEF1F4");

/** Excel's limit is 31 characters and no []:*?/\ */
export function sheetName(name: string): string {
  const clean = name.replace(/[[\]:*?/\\]/g, " ").trim() || "Sheet";
  return clean.slice(0, 31);
}

function writeCell(ws: Worksheet, r: number, c: number, cell: GridCell) {
  const xc = ws.getCell(r, c);
  const isHeader = cell.kind !== "data";
  if (cell.kind === "data") {
    if (typeof cell.value === "number") {
      xc.value = cell.value;
      xc.numFmt = excelNumFmt(cell.digits ?? (Number.isInteger(cell.value) ? 0 : 2), !!cell.percent);
    } else if (cell.value !== null) {
      xc.value = cell.value;
    }
    xc.alignment = { horizontal: "right", vertical: "top" };
  } else {
    xc.value = cell.text || null;
    xc.alignment = {
      horizontal: cell.kind === "axisLabel" && cell.colSpan > 1 ? "right" : "left",
      vertical: "top",
    };
  }
  xc.border = border;
  const bold = isHeader && cell.kind !== "rowHeader";
  xc.font = { bold: bold || !!cell.total };
  if (cell.total === "grand") xc.fill = GRAND_FILL;
  else if (cell.total === "sub") xc.fill = SUB_FILL;
  else if (cell.kind === "rowHeader") xc.fill = LABEL_FILL;
  else if (isHeader) xc.fill = HEADER_FILL;
}

export interface XlsxOptions {
  /** Add a second sheet with the source rows, so the data can be re-pivoted in Excel. */
  dataset?: Dataset;
}

export async function toXlsx(grid: PivotGrid, meta: ExportMeta, opts: XlsxOptions = {}): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Beekeeper Studio Pivot Tables";
  wb.created = new Date();

  const ws = wb.addWorksheet(sheetName("Pivot"));
  ws.getCell(1, 1).value = meta.title;
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  if (meta.subtitle) {
    ws.getCell(2, 1).value = meta.subtitle;
    ws.getCell(2, 1).font = { color: { argb: "FF656D76" } };
  }
  const top = 4;
  const widths = new Array(grid.width).fill(8);
  const merges: [number, number, number, number][] = [];

  const writeRow = (cells: GridCell[], r: number) => {
    cells.forEach((cell, i) => {
      const c = i + 1;
      if (cell.hidden) {
        // Covered cells still get borders/fills so merged areas look right.
        const xc = ws.getCell(r, c);
        xc.border = border;
        return;
      }
      writeCell(ws, r, c, cell);
      if (cell.colSpan > 1 || cell.rowSpan > 1) merges.push([r, c, r + cell.rowSpan - 1, c + cell.colSpan - 1]);
      if (cell.colSpan === 1) widths[i] = Math.max(widths[i], Math.min(60, cell.text.length + 2));
    });
  };

  grid.header.forEach((row, i) => writeRow(row, top + i));
  let r = top + grid.headerRows;
  for (const row of bodyRows(grid)) writeRow(row, r++);
  for (const [t, l, b, rr] of merges) ws.mergeCells(t, l, b, rr);
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.views = [{ state: "frozen", xSplit: grid.rowHeaderCols, ySplit: top - 1 + grid.headerRows }];

  if (opts.dataset) {
    const ds = opts.dataset;
    const data = wb.addWorksheet(sheetName("Data"));
    data.addRow(ds.columns.map((c) => c.name));
    data.getRow(1).font = { bold: true };
    data.getRow(1).fill = HEADER_FILL;
    for (const row of ds.rows) {
      data.addRow(
        row.map((v) => {
          if (v === null || v === undefined) return null;
          if (typeof v === "number" || typeof v === "string" || typeof v === "boolean" || v instanceof Date) return v;
          if (typeof v === "bigint") return Number(v);
          return JSON.stringify(v);
        })
      );
    }
    data.views = [{ state: "frozen", ySplit: 1 }];
    if (ds.columns.length) {
      data.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ds.columns.length } };
    }
    ds.columns.forEach((c, i) => (data.getColumn(i + 1).width = Math.min(40, Math.max(10, c.name.length + 2))));
  }

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
