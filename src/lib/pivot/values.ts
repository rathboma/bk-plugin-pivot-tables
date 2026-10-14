import type { CellValue, DateGrouping } from "./types";

export const NULL_LABEL = "(null)";
export const EMPTY_LABEL = "(empty)";

const NUMERIC_RE = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

/** Parse a value as a number. Returns NaN when it isn't numeric. */
export function toNumber(v: CellValue): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") {
    const s = v.trim();
    return NUMERIC_RE.test(s) ? parseFloat(s) : NaN;
  }
  return NaN;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

function formatDate(d: Date): string {
  if (isNaN(d.getTime())) return String(d);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0) {
    return date;
  }
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Turn any value into the label used for grouping and display. */
export function toLabel(v: CellValue): string {
  if (v === null || v === undefined) return NULL_LABEL;
  if (typeof v === "string") return v === "" ? EMPTY_LABEL : v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  if (v instanceof Date) return formatDate(v);
  if (v instanceof Uint8Array) return `<binary ${v.byteLength} bytes>`;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export interface DateParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(?:Z|[+-]\d{2}(?::?\d{2})?)?$/;

/**
 * Pull the calendar parts out of a date-ish value. Strings are read as
 * written (wall-clock time), so a value groups the same way it's displayed
 * in Beekeeper's result grid regardless of the local time zone.
 */
export function parseDateParts(v: CellValue): DateParts | null {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return {
      year: v.getFullYear(),
      month: v.getMonth() + 1,
      day: v.getDate(),
      hour: v.getHours(),
      minute: v.getMinutes(),
    };
  }
  if (typeof v !== "string") return null;
  const m = DATE_RE.exec(v.trim());
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return {
    year: Number(m[1]),
    month,
    day,
    hour: m[4] ? Number(m[4]) : 0,
    minute: m[5] ? Number(m[5]) : 0,
  };
}

export function looksLikeDate(v: CellValue): boolean {
  return parseDateParts(v) !== null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Monday = 0 ... Sunday = 6 */
function weekdayIndex(p: DateParts): number {
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
  return (d.getUTCDay() + 6) % 7;
}

function isoWeek(p: DateParts): { year: number; week: number } {
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const dayNum = (d.getUTCDay() + 6) % 7;
  // Move to the Thursday of this week; its year is the ISO year.
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const isoYear = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return { year: isoYear, week };
}

export interface GroupedLabel {
  label: string;
  /** Used for ordering when the label alone doesn't sort correctly. */
  sort?: number;
}

/** Label for a value under a date grouping. Non-dates fall back to their plain label. */
export function groupedLabel(v: CellValue, group: DateGrouping | undefined): GroupedLabel {
  if (!group || group === "none") return { label: toLabel(v) };
  const p = parseDateParts(v);
  if (!p) return { label: toLabel(v) };
  switch (group) {
    case "year":
      return { label: String(p.year) };
    case "quarter":
      return { label: `${p.year}-Q${Math.floor((p.month - 1) / 3) + 1}` };
    case "month":
      return { label: `${p.year}-${pad(p.month)}` };
    case "week": {
      const w = isoWeek(p);
      return { label: `${w.year}-W${pad(w.week)}` };
    }
    case "day":
      return { label: `${p.year}-${pad(p.month)}-${pad(p.day)}` };
    case "hour":
      return { label: `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:00` };
    case "monthOfYear":
      return { label: MONTHS[p.month - 1], sort: p.month };
    case "dayOfWeek": {
      const i = weekdayIndex(p);
      return { label: WEEKDAYS[i], sort: i };
    }
  }
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Natural ascending comparison of two labels. Null/empty labels sort last. */
export function compareLabels(a: string, b: string): number {
  if (a === b) return 0;
  const aNull = a === NULL_LABEL;
  const bNull = b === NULL_LABEL;
  if (aNull !== bNull) return aNull ? 1 : -1;
  const na = toNumber(a);
  const nb = toNumber(b);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  return collator.compare(a, b);
}
