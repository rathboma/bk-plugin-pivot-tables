import { clipboard, requestFileSave } from "@beekeeperstudio/plugin";
import { bodyRows, type PivotGrid } from "../pivot/grid";
import type { Dataset } from "../pivot/types";
import { renderImage } from "./image";
import { needsUnicodeFont, toPdf } from "./pdf";
import { toCsv, toHtmlDocument, toJson, toMarkdown, toTsv, type ExportMeta } from "./text";
import { toXlsx } from "./xlsx";
import { arrayBufferToBase64, safeFileName } from "./util";

export { arrayBufferToBase64, safeFileName };

export type ExportFormat = "xlsx" | "xlsxData" | "pdf" | "png" | "md" | "csv" | "html" | "json";
export type CopyFormat = "tsv" | "md" | "png";

export const EXPORT_FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: "xlsx", label: "Excel", hint: ".xlsx" },
  { id: "xlsxData", label: "Excel + source data", hint: ".xlsx, 2 sheets" },
  { id: "pdf", label: "PDF", hint: ".pdf" },
  { id: "png", label: "Image", hint: ".png" },
  { id: "md", label: "Markdown", hint: ".md" },
  { id: "csv", label: "CSV", hint: ".csv" },
  { id: "html", label: "HTML", hint: ".html" },
  { id: "json", label: "JSON", hint: ".json" },
];

export const COPY_FORMATS: { id: CopyFormat; label: string; hint: string }[] = [
  { id: "tsv", label: "Copy for spreadsheet", hint: "Excel, Sheets" },
  { id: "md", label: "Copy as Markdown", hint: "GitHub, docs" },
  { id: "png", label: "Copy as image", hint: "Slack, email" },
];

const FILTERS: Record<ExportFormat, { name: string; extensions: string[] }> = {
  xlsx: { name: "Excel Workbook", extensions: ["xlsx"] },
  xlsxData: { name: "Excel Workbook", extensions: ["xlsx"] },
  pdf: { name: "PDF Document", extensions: ["pdf"] },
  png: { name: "PNG Image", extensions: ["png"] },
  md: { name: "Markdown", extensions: ["md"] },
  csv: { name: "CSV", extensions: ["csv"] },
  html: { name: "HTML Document", extensions: ["html"] },
  json: { name: "JSON", extensions: ["json"] },
};

export interface ExportContext {
  meta: ExportMeta;
  dataset: Dataset;
  /** File name without extension. */
  fileBase: string;
}

export interface ExportOutcome {
  /** Something worth telling the user, e.g. rows left out of an image. */
  note?: string;
}

async function pdfFont(grid: PivotGrid, meta: ExportMeta) {
  const texts = function* () {
    yield meta.title;
    if (meta.subtitle) yield meta.subtitle;
    for (const row of grid.header) for (const c of row) yield c.text;
    for (const row of bodyRows(grid)) for (const c of row) yield c.text;
  };
  if (!needsUnicodeFont(texts())) return undefined;
  const { loadUnicodeFont } = await import("./fonts");
  return loadUnicodeFont();
}

export async function exportPivot(format: ExportFormat, grid: PivotGrid, ctx: ExportContext): Promise<ExportOutcome> {
  const ext = FILTERS[format].extensions[0];
  const fileName = `${safeFileName(ctx.fileBase)}.${ext}`;
  const filters = [FILTERS[format], { name: "All Files", extensions: ["*"] }];
  let data: string;
  let encoding: "utf8" | "base64" = "utf8";
  let note: string | undefined;

  switch (format) {
    case "xlsx":
    case "xlsxData":
      data = arrayBufferToBase64(await toXlsx(grid, ctx.meta, { dataset: format === "xlsxData" ? ctx.dataset : undefined }));
      encoding = "base64";
      break;
    case "pdf":
      data = arrayBufferToBase64(await toPdf(grid, ctx.meta, await pdfFont(grid, ctx.meta)));
      encoding = "base64";
      break;
    case "png": {
      const img = renderImage(grid, ctx.meta);
      data = img.dataUrl.slice(img.dataUrl.indexOf(",") + 1);
      encoding = "base64";
      if (img.omittedRows) note = `The image shows the first rows only (${img.omittedRows.toLocaleString()} left out).`;
      break;
    }
    case "md":
      data = `# ${ctx.meta.title}\n\n${ctx.meta.subtitle ? `${ctx.meta.subtitle}\n\n` : ""}${toMarkdown(grid)}`;
      break;
    case "csv":
      data = toCsv(grid);
      break;
    case "html":
      data = toHtmlDocument(grid, ctx.meta);
      break;
    case "json":
      data = toJson(grid);
      break;
  }

  await requestFileSave({ data, fileName, encoding, filters });
  return { note };
}

export async function copyPivot(format: CopyFormat, grid: PivotGrid, ctx: ExportContext): Promise<ExportOutcome> {
  switch (format) {
    case "tsv":
      await clipboard.writeText(toTsv(grid));
      return {};
    case "md":
      await clipboard.writeText(toMarkdown(grid));
      return {};
    case "png": {
      const img = renderImage(grid, ctx.meta);
      // Beekeeper passes this to Electron's nativeImage.createFromDataURL.
      await clipboard.writeImage(img.dataUrl);
      return img.omittedRows ? { note: `Copied the first rows only (${img.omittedRows.toLocaleString()} left out).` } : {};
    }
  }
}
