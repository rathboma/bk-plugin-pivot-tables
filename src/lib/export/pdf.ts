import type { CellDef, RowInput, Styles } from "jspdf-autotable";
import type { jsPDF as JsPDF } from "jspdf";
import type { GridCell, PivotGrid } from "../pivot/grid";
import type { ExportMeta } from "./text";

type RGB = [number, number, number];
const HEADER: RGB = [243, 244, 246];
const LABEL: RGB = [250, 251, 252];
const SUB: RGB = [246, 248, 250];
const GRAND: RGB = [234, 238, 242];
const BORDER: RGB = [208, 215, 222];
const TEXT: RGB = [31, 35, 40];
const MUTED: RGB = [101, 109, 118];

const BASE_FONT = 8;
const MIN_FONT = 5.5;
const PAD_X = 5;
const MARGIN = 36;
/** Columns are measured on this many body rows; enough to size them sensibly. */
const MEASURE_ROWS = 400;

/** Characters Helvetica (WinAnsi) can draw. Anything else needs an embedded font. */
// eslint-disable-next-line no-control-regex
const WIN_ANSI = /^[\x00-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]*$/;

export function needsUnicodeFont(texts: Iterable<string>): boolean {
  for (const t of texts) if (!WIN_ANSI.test(t)) return true;
  return false;
}

function pdfCell(c: GridCell, text = c.text, colSpan = c.colSpan): CellDef {
  const styles: Partial<Styles> = {};
  if (c.kind === "data") styles.halign = "right";
  else if (c.kind === "axisLabel" && colSpan > 1) styles.halign = "right";
  if (c.kind === "rowHeader") {
    styles.fillColor = LABEL;
    styles.fontStyle = "normal";
  }
  if (c.kind === "axisLabel") styles.textColor = MUTED;
  if (c.total === "sub") {
    styles.fillColor = SUB;
    styles.fontStyle = "bold";
  } else if (c.total === "grand") {
    styles.fillColor = GRAND;
    styles.fontStyle = "bold";
  }
  return { content: text, colSpan, rowSpan: c.rowSpan, styles };
}

interface Owner {
  r: number;
  c: number;
}

/** Which visible cell covers each header position. */
function headerOwners(grid: PivotGrid): Owner[][] {
  const owners: Owner[][] = grid.header.map((row) => row.map(() => ({ r: -1, c: -1 })));
  grid.header.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (cell.hidden) return;
      for (let rr = r; rr < Math.min(grid.headerRows, r + cell.rowSpan); rr++) {
        for (let cc = c; cc < Math.min(grid.width, c + cell.colSpan); cc++) owners[rr][cc] = { r, c };
      }
    })
  );
  return owners;
}

/** Header rows for the row label columns plus data columns [start, end), with spans clipped to the slice. */
function sliceHeader(grid: PivotGrid, owners: Owner[][], start: number, end: number): RowInput[] {
  const R = grid.rowHeaderCols;
  return grid.header.map((_row, r) => {
    const out: CellDef[] = [];
    const emit = (from: number, to: number) => {
      for (let c = from; c < to; c++) {
        const o = owners[r][c];
        if (o.r !== r) continue; // covered by a cell from a row above
        if (o.c !== c && c !== from) continue; // covered from the left within this slice
        const owner = grid.header[o.r][o.c];
        const span = Math.min(o.c + owner.colSpan, to) - c;
        out.push(pdfCell(owner, owner.text, span));
        c += span - 1;
      }
    };
    emit(0, R);
    emit(start, end);
    return out;
  });
}

function sliceBody(row: GridCell[], R: number, start: number, end: number): RowInput {
  const out: CellDef[] = [];
  for (let c = 0; c < R; c++) if (!row[c].hidden) out.push(pdfCell(row[c]));
  for (let c = start; c < end; c++) if (!row[c].hidden) out.push(pdfCell(row[c]));
  return out;
}

/** Natural width (pt) of each column at `fontSize`. */
function measureColumns(doc: JsPDF, grid: PivotGrid, fontName: string, fontSize: number): number[] {
  const widths = new Array(grid.width).fill(fontSize * 3);
  const textWidth = (c: GridCell) => {
    doc.setFont(fontName, c.total || (c.kind !== "data" && c.kind !== "rowHeader") ? "bold" : "normal");
    return (doc.getStringUnitWidth(c.text) * fontSize) + PAD_X * 2 + 1;
  };
  const rows = [...grid.header];
  for (let i = 0; i < Math.min(grid.bodyRowCount, MEASURE_ROWS); i++) rows.push(grid.bodyRow(i));
  for (const row of rows) {
    row.forEach((c, i) => {
      if (!c.hidden && c.colSpan === 1) widths[i] = Math.max(widths[i], Math.min(200, textWidth(c)));
    });
  }
  return widths;
}

/** Split data columns into page-width slices, preferring to break between top-level column groups. */
function sliceColumns(grid: PivotGrid, widths: number[], available: number): [number, number][] {
  const R = grid.rowHeaderCols;
  const labelW = widths.slice(0, R).reduce((a, b) => a + b, 0);
  const room = Math.max(available - labelW, available * 0.4);
  const groupStart = new Set<number>();
  const top = grid.header[0];
  top.forEach((c, i) => {
    if (i >= R && !c.hidden) groupStart.add(i);
  });

  const slices: [number, number][] = [];
  let start = R;
  while (start < grid.width) {
    let used = 0;
    let end = start;
    while (end < grid.width && (end === start || used + widths[end] <= room)) used += widths[end++];
    if (end < grid.width) {
      // Back up to the last group boundary if that keeps at least half the page full.
      for (let b = end; b > start; b--) {
        if (groupStart.has(b)) {
          const w = widths.slice(start, b).reduce((a, x) => a + x, 0);
          if (w >= room * 0.5) end = b;
          break;
        }
      }
    }
    slices.push([start, end]);
    start = end;
  }
  if (!slices.length) slices.push([R, R]);
  return slices;
}

export interface PdfFont {
  name: string;
  regular: string; // base64 TTF
  bold: string; // base64 TTF
}

export async function toPdf(grid: PivotGrid, meta: ExportMeta, font?: PdfFont): Promise<ArrayBuffer> {
  const { jsPDF } = await import("jspdf");
  const { autoTable } = await import("jspdf-autotable");

  const landscape = grid.width > 6;
  const doc = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "pt", format: "a4" });
  let fontName = "helvetica";
  if (font) {
    doc.addFileToVFS(`${font.name}-Regular.ttf`, font.regular);
    doc.addFont(`${font.name}-Regular.ttf`, font.name, "normal");
    doc.addFileToVFS(`${font.name}-Bold.ttf`, font.bold);
    doc.addFont(`${font.name}-Bold.ttf`, font.name, "bold");
    fontName = font.name;
  }
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const available = pageW - MARGIN * 2;

  // Fit mildly wide tables by shrinking the font; split very wide ones into column slices.
  const natural = measureColumns(doc, grid, fontName, BASE_FONT);
  const total = natural.reduce((a, b) => a + b, 0);
  let fontSize = BASE_FONT;
  let widths = natural;
  if (total > available) {
    const scaled = (BASE_FONT * available) / total;
    fontSize = Math.max(MIN_FONT, Math.floor(scaled * 10) / 10);
    widths = natural.map((w) => (w * fontSize) / BASE_FONT);
  }
  const slices = sliceColumns(grid, widths, available);
  const owners = headerOwners(grid);
  const dataCols = grid.width - grid.rowHeaderCols;

  doc.setFont(fontName, "bold");
  doc.setFontSize(14);
  doc.setTextColor(...TEXT);
  doc.text(meta.title, MARGIN, MARGIN + 6);
  let y = MARGIN + 14;
  if (meta.subtitle) {
    doc.setFont(fontName, "normal");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    const lines = doc.splitTextToSize(meta.subtitle, available);
    doc.text(lines, MARGIN, y + 8);
    y += 8 + lines.length * 11;
  }

  const body: GridCell[][] = [];
  for (let i = 0; i < grid.bodyRowCount; i++) body.push(grid.bodyRow(i));

  slices.forEach(([start, end], si) => {
    if (si > 0) {
      doc.addPage();
      y = MARGIN;
    }
    if (slices.length > 1) {
      doc.setFont(fontName, "normal");
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text(
        `Columns ${start - grid.rowHeaderCols + 1}–${end - grid.rowHeaderCols} of ${dataCols}`,
        MARGIN,
        y + 8
      );
      y += 12;
    }
    autoTable(doc, {
      head: sliceHeader(grid, owners, start, end),
      body: body.map((row) => sliceBody(row, grid.rowHeaderCols, start, end)),
      startY: y + 4,
      margin: { left: MARGIN, right: MARGIN, top: MARGIN, bottom: MARGIN },
      theme: "grid",
      tableWidth: "wrap",
      rowPageBreak: "avoid",
      styles: {
        font: fontName,
        fontSize,
        cellPadding: { top: fontSize * 0.4, right: PAD_X, bottom: fontSize * 0.4, left: PAD_X },
        lineColor: BORDER,
        lineWidth: 0.5,
        textColor: TEXT,
        overflow: "linebreak",
        valign: "top",
      },
      headStyles: { fillColor: HEADER, textColor: TEXT, fontStyle: "bold" },
      didDrawPage: () => {
        const page = doc.getCurrentPageInfo().pageNumber;
        doc.setFont(fontName, "normal");
        doc.setFontSize(8);
        doc.setTextColor(...MUTED);
        doc.text(`Page ${page}`, pageW - MARGIN, pageH - MARGIN / 2, { align: "right" });
      },
    });
  });

  return doc.output("arraybuffer");
}
