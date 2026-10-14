import { bodyRows, flatHeader, type GridCell, type PivotGrid } from "../pivot/grid";
import { uniqueNames } from "../source/dataset";

export interface ExportMeta {
  title: string;
  subtitle?: string;
}

/** Raw value for machine-readable formats. */
function rawValue(c: GridCell): string | number | null {
  if (c.kind === "data") return c.value;
  return c.text === "" ? null : c.text;
}

function csvEscape(s: string, sep: string): string {
  return /["\r\n]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toDelimited(grid: PivotGrid, sep = ","): string {
  const lines = [flatHeader(grid).map((h) => csvEscape(h, sep)).join(sep)];
  for (const row of bodyRows(grid)) {
    lines.push(
      row
        .map((c) => {
          const v = rawValue(c);
          return v === null ? "" : csvEscape(String(v), sep);
        })
        .join(sep)
    );
  }
  return lines.join("\r\n") + "\r\n";
}

export const toCsv = (grid: PivotGrid) => toDelimited(grid, ",");

/** Tab separated, for pasting into spreadsheets. Percentages keep their % so they paste as percentages. */
export function toTsv(grid: PivotGrid): string {
  const clean = (s: string) => s.replace(/[\t\r\n]+/g, " ");
  const lines = [flatHeader(grid).map(clean).join("\t")];
  for (const row of bodyRows(grid)) {
    lines.push(
      row
        .map((c) => {
          if (c.kind === "data" && typeof c.value === "number") {
            return c.percent ? `${+(c.value * 100).toFixed(6)}%` : String(c.value);
          }
          return clean(c.text);
        })
        .join("\t")
    );
  }
  return lines.join("\n");
}

function mdEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function toMarkdown(grid: PivotGrid): string {
  const header = flatHeader(grid).map((h, i) => mdEscape(h) || (i < grid.rowHeaderCols ? " " : ""));
  const align = header.map((_, i) => (i < grid.rowHeaderCols ? ":---" : "---:"));
  const lines = [`| ${header.join(" | ")} |`, `| ${align.join(" | ")} |`];
  for (const row of bodyRows(grid)) {
    const cells = row.map((c) => {
      // Repeated row labels read better blank, like a spreadsheet pivot.
      if (c.hidden && c.kind === "rowHeader") return "";
      const text = mdEscape(c.text);
      return c.total && c.kind === "rowHeader" && text ? `**${text}**` : text;
    });
    lines.push(`| ${cells.join(" | ")} |`);
  }
  return lines.join("\n") + "\n";
}

export function toJson(grid: PivotGrid): string {
  const keys = uniqueNames(flatHeader(grid).map((h, i) => h || `column_${i + 1}`));
  const out: Record<string, string | number | null>[] = [];
  for (const row of bodyRows(grid)) {
    const obj: Record<string, string | number | null> = {};
    row.forEach((c, i) => (obj[keys[i]] = rawValue(c)));
    out.push(obj);
  }
  return JSON.stringify(out, null, 2);
}

const htmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function htmlCell(c: GridCell, tag: "th" | "td"): string {
  const attrs: string[] = [];
  if (c.colSpan > 1) attrs.push(`colspan="${c.colSpan}"`);
  if (c.rowSpan > 1) attrs.push(`rowspan="${c.rowSpan}"`);
  const cls = [c.kind, c.total ? `total-${c.total}` : ""].filter(Boolean).join(" ");
  attrs.push(`class="${cls}"`);
  return `<${tag} ${attrs.join(" ")}>${htmlEscape(c.text)}</${tag}>`;
}

/** Just the `<table>` element, with spans. */
export function toHtmlTable(grid: PivotGrid): string {
  const parts = ["<table>", "<thead>"];
  for (const row of grid.header) {
    parts.push("<tr>" + row.filter((c) => !c.hidden).map((c) => htmlCell(c, "th")).join("") + "</tr>");
  }
  parts.push("</thead>", "<tbody>");
  for (const row of bodyRows(grid)) {
    parts.push(
      "<tr>" +
        row
          .filter((c) => !c.hidden)
          .map((c) => htmlCell(c, c.kind === "data" ? "td" : "th"))
          .join("") +
        "</tr>"
    );
  }
  parts.push("</tbody>", "</table>");
  return parts.join("\n");
}

export function toHtmlDocument(grid: PivotGrid, meta: ExportMeta): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlEscape(meta.title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1f2328; margin: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.subtitle { color: #656d76; font-size: 13px; margin: 0 0 16px; }
  table { border-collapse: collapse; font-size: 13px; }
  th, td { border: 1px solid #d0d7de; padding: 4px 10px; white-space: nowrap; }
  thead th { background: #f3f4f6; font-weight: 600; text-align: left; }
  th.axisLabel { color: #656d76; font-weight: 600; }
  tbody th { background: #fafbfc; font-weight: 500; text-align: left; vertical-align: top; }
  td { text-align: right; font-variant-numeric: tabular-nums; }
  .total-sub { background: #f6f8fa; font-weight: 600; }
  .total-grand { background: #eef1f4; font-weight: 700; }
</style>
</head>
<body>
<h1>${htmlEscape(meta.title)}</h1>
${meta.subtitle ? `<p class="subtitle">${htmlEscape(meta.subtitle)}</p>` : ""}
${toHtmlTable(grid)}
</body>
</html>
`;
}
