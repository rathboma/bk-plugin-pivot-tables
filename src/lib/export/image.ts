import type { GridCell, PivotGrid } from "../pivot/grid";
import type { ExportMeta } from "./text";

const PALETTE = {
  background: "#ffffff",
  header: "#f3f4f6",
  label: "#fafbfc",
  sub: "#f6f8fa",
  grand: "#eaeef2",
  border: "#d0d7de",
  text: "#1f2328",
  muted: "#656d76",
};

const FONT_FAMILY = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
const FONT_SIZE = 13;
const ROW_H = 26;
const PAD_X = 10;
const MIN_COL = 36;
const MAX_COL = 360;
const MARGIN = 20;
const MAX_CANVAS_SIDE = 16000;
const MAX_CANVAS_AREA = 120_000_000;

export interface ImageOptions {
  /** Body rows to draw at most; the rest are summarised in a footer. */
  maxRows?: number;
  /** Device pixel ratio to render at. */
  scale?: number;
}

export interface ImageResult {
  dataUrl: string;
  width: number;
  height: number;
  /** Body rows left out because of `maxRows` or canvas size limits. */
  omittedRows: number;
}

const fontFor = (c: GridCell, size = FONT_SIZE) =>
  `${c.total || (c.kind !== "data" && c.kind !== "rowHeader") ? "600" : "400"} ${size}px ${FONT_FAMILY}`;

function fillFor(c: GridCell): string {
  if (c.total === "grand") return PALETTE.grand;
  if (c.total === "sub") return PALETTE.sub;
  if (c.kind === "data") return PALETTE.background;
  if (c.kind === "rowHeader") return PALETTE.label;
  return PALETTE.header;
}

export function renderImage(grid: PivotGrid, meta: ExportMeta, opts: ImageOptions = {}): ImageResult {
  const measureCanvas = document.createElement("canvas");
  const m = measureCanvas.getContext("2d")!;
  const measure = (c: GridCell) => {
    m.font = fontFor(c);
    return m.measureText(c.text).width + PAD_X * 2;
  };

  let rowsToDraw = Math.min(grid.bodyRowCount, opts.maxRows ?? 2000);
  const titleH = meta.subtitle ? 58 : 40;
  // Keep within canvas limits at 1x.
  const maxRowsBySize = Math.floor((MAX_CANVAS_SIDE - MARGIN * 2 - titleH - ROW_H * (grid.headerRows + 1)) / ROW_H);
  rowsToDraw = Math.max(0, Math.min(rowsToDraw, maxRowsBySize));
  const omittedRows = grid.bodyRowCount - rowsToDraw;

  const rows: GridCell[][] = [...grid.header];
  for (let i = 0; i < rowsToDraw; i++) rows.push(grid.bodyRow(i));
  const drawnRows = rows.length;

  const widths = new Array(grid.width).fill(MIN_COL);
  for (const row of rows) {
    row.forEach((c, i) => {
      if (!c.hidden && c.colSpan === 1) widths[i] = Math.max(widths[i], Math.min(MAX_COL, measure(c)));
    });
  }
  for (const row of rows) {
    row.forEach((c, i) => {
      if (c.hidden || c.colSpan === 1) return;
      let total = 0;
      for (let k = i; k < i + c.colSpan; k++) total += widths[k];
      const need = Math.min(MAX_COL * c.colSpan, measure(c));
      if (need > total) widths[i + c.colSpan - 1] += need - total;
    });
  }

  const colX: number[] = [];
  let x = MARGIN;
  for (const w of widths) {
    colX.push(x);
    x += w;
  }
  const tableW = x - MARGIN;
  m.font = `600 18px ${FONT_FAMILY}`;
  const titleW = m.measureText(meta.title).width;
  m.font = `400 12px ${FONT_FAMILY}`;
  const subtitleW = meta.subtitle ? m.measureText(meta.subtitle).width : 0;
  const footerH = omittedRows > 0 ? ROW_H : 0;

  const width = Math.ceil(Math.min(MAX_CANVAS_SIDE, Math.max(tableW, titleW, subtitleW) + MARGIN * 2));
  const height = Math.ceil(MARGIN * 2 + titleH + drawnRows * ROW_H + footerH);
  let scale = opts.scale ?? 2;
  scale = Math.min(scale, MAX_CANVAS_SIDE / width, MAX_CANVAS_SIDE / height, Math.sqrt(MAX_CANVAS_AREA / (width * height)));

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(width * scale);
  canvas.height = Math.floor(height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = PALETTE.background;
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = "middle";

  ctx.fillStyle = PALETTE.text;
  ctx.font = `600 18px ${FONT_FAMILY}`;
  ctx.fillText(meta.title, MARGIN, MARGIN + 10);
  if (meta.subtitle) {
    ctx.fillStyle = PALETTE.muted;
    ctx.font = `400 12px ${FONT_FAMILY}`;
    ctx.fillText(meta.subtitle, MARGIN, MARGIN + 32);
  }

  const top = MARGIN + titleH;
  ctx.lineWidth = 1;
  rows.forEach((row, r) => {
    row.forEach((c, i) => {
      if (c.hidden) return;
      const cx = colX[i];
      const cy = top + r * ROW_H;
      let w = 0;
      for (let k = i; k < Math.min(grid.width, i + c.colSpan); k++) w += widths[k];
      const h = Math.min(c.rowSpan, drawnRows - r) * ROW_H;

      ctx.fillStyle = fillFor(c);
      ctx.fillRect(cx, cy, w, h);
      ctx.strokeStyle = PALETTE.border;
      ctx.strokeRect(cx + 0.5, cy + 0.5, w, h);

      if (!c.text) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx + 1, cy + 1, w - 2, h - 2);
      ctx.clip();
      ctx.font = fontFor(c);
      ctx.fillStyle = c.kind === "axisLabel" ? PALETTE.muted : PALETTE.text;
      const right = c.kind === "data" || (c.kind === "axisLabel" && c.colSpan > 1);
      ctx.textAlign = right ? "right" : "left";
      ctx.fillText(c.text, right ? cx + w - PAD_X : cx + PAD_X, cy + ROW_H / 2 + 1);
      ctx.restore();
    });
  });

  if (omittedRows > 0) {
    ctx.fillStyle = PALETTE.muted;
    ctx.font = `italic 400 12px ${FONT_FAMILY}`;
    ctx.textAlign = "left";
    ctx.fillText(
      `… ${omittedRows.toLocaleString()} more rows not shown. Export to Excel or CSV for the full table.`,
      MARGIN,
      top + drawnRows * ROW_H + ROW_H / 2 + 2
    );
  }

  return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height, omittedRows };
}
