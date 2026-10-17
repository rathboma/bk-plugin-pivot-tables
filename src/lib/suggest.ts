import type { CellValue, ColumnType, Dataset, DateGrouping, PivotConfig } from "./pivot/types";
import { EMPTY_LABEL, NULL_LABEL, parseDateParts, toLabel, toNumber, type DateParts } from "./pivot/values";
import { defaultConfig, makeValue } from "./state";

const SAMPLE_ROWS = 5000;
/** Most labels a suggested row field may have. */
const MAX_ROW_LABELS = 50;
const MAX_LABEL_LENGTH = 40;
/** Most date buckets for a suggested column or row field. */
const MAX_DATE_COLS = 12;
const MAX_DATE_ROWS = 31;

const ID_WORDS = new Set(["id", "ids", "uuid", "guid", "pk", "fk", "key", "oid", "rowid"]);
const SECRET_WORDS = new Set(["password", "passwd", "hash", "digest", "token", "secret", "salt", "nonce", "otp", "signature"]);
const DIMENSION_WORDS = new Set([
  "status", "state", "type", "types", "kind", "category", "categories", "class", "group", "segment", "tier", "plan",
  "level", "stage", "priority", "severity", "region", "country", "city", "province", "territory", "county",
  "continent", "location", "zone", "area", "market", "department", "dept", "division", "team", "role", "channel",
  "source", "medium", "campaign", "platform", "device", "browser", "os", "brand", "vendor", "supplier",
  "manufacturer", "carrier", "product", "genre", "gender", "rating", "language", "locale", "currency", "method",
  "mode", "reason", "outcome", "result", "grade", "size", "color", "colour", "industry", "sector", "store",
  "branch", "office", "warehouse", "site",
]);
const TEXT_WORDS = new Set([
  "description", "notes", "note", "comment", "comments", "message", "body", "content", "summary", "text", "details",
  "address", "street", "email", "phone", "mobile", "fax", "url", "link", "path", "ip", "agent",
]);
const EVENT_DATE_WORDS = new Set([
  "created", "order", "ordered", "placed", "purchased", "paid", "sold", "booked", "signup", "signed",
  "registered", "joined", "start", "started", "occurred", "issued", "invoice", "invoiced", "submitted", "received",
  "shipped", "transaction", "event", "payment", "rental",
]);
const DATE_WORDS = new Set(["date", "time", "timestamp", "datetime", "day"]);
const META_DATE_WORDS = new Set([
  "updated", "update", "modified", "changed", "deleted", "removed", "archived", "expires", "expired", "expiry",
  "expiration", "synced", "imported", "refreshed", "last", "birth", "birthday", "dob", "born", "locked", "seen",
  "login", "accessed", "verified", "confirmed",
]);
/** Columns worth summing, best first. Prices, rates and per-item attributes aren't additive, so they're left out. */
const MEASURE_WORDS = [
  "revenue", "sales", "total", "amount", "amt", "subtotal", "gross", "net", "profit", "income", "spend", "spent",
  "paid", "payment", "quantity", "qty", "units", "views", "clicks", "impressions", "visits", "sessions", "downloads",
];
const NOT_MEASURE_WORDS = new Set([
  "year", "month", "week", "day", "quarter", "hour", "zip", "postal", "postcode", "phone", "lat", "latitude", "lng",
  "lon", "longitude", "version", "position", "rank", "sort", "index", "seq", "sequence", "number", "num", "no", "code",
  "pct", "percent", "percentage", "rate", "ratio", "avg", "average", "mean", "median", "min", "max",
]);

/** Lowercase words of a column name: `orderStatus`, `order_status` and `Order Status` give `["order", "status"]`. */
export function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const hasAny = (words: string[], set: Set<string>) => words.some((w) => set.has(w));

interface Column {
  name: string;
  words: string[];
  values: CellValue[];
}

function isMissing(v: CellValue): boolean {
  const label = toLabel(v);
  return label === NULL_LABEL || label === EMPTY_LABEL || (typeof v === "string" && !v.trim());
}

/**
 * A category-like column's score, or null when it would make poor rows.
 * Columns whose values hardly repeat are only used when there's something to
 * sum, as in a `GROUP BY` result.
 */
function dimensionScore(col: Column, hasMeasure: boolean): number | null {
  if (hasAny(col.words, ID_WORDS) || hasAny(col.words, SECRET_WORDS)) return null;
  const counts = new Map<string, number>();
  let present = 0;
  for (const v of col.values) {
    if (isMissing(v)) continue;
    if (typeof v === "object" && !(v instanceof Date)) return null; // JSON, arrays, binary
    const label = toLabel(v);
    if (!counts.has(label) && counts.size === MAX_ROW_LABELS) return null;
    counts.set(label, (counts.get(label) ?? 0) + 1);
    present++;
  }
  if (present < col.values.length / 2 || counts.size < 2) return null;
  const unique = counts.size > present / 2;
  if (unique && !hasMeasure) return null;
  const labels = [...counts.keys()];
  if (labels.reduce((n, l) => n + l.length, 0) / labels.length > MAX_LABEL_LENGTH) return null;

  const n = counts.size;
  let score = n === 2 ? 1 : n <= 12 ? 3 : n <= 25 ? 2 : 1;
  if (hasAny(col.words, DIMENSION_WORDS)) score += 2;
  if (hasAny(col.words, TEXT_WORDS)) score -= 2;
  if (unique) score -= 1;
  if (present < col.values.length * 0.8) score -= 1;
  if (Math.max(...counts.values()) / present >= 0.9) score -= 1;
  return score > 0 ? score : null;
}

const DATE_LADDER: [DateGrouping, (p: DateParts) => number][] = [
  ["day", (p) => Date.UTC(p.year, p.month - 1, p.day) / 86_400_000],
  ["month", (p) => p.year * 12 + p.month - 1],
  ["quarter", (p) => p.year * 4 + Math.floor((p.month - 1) / 3)],
  ["year", (p) => p.year],
];

/** The finest date grouping that spans 2 to `maxBuckets` buckets, or null. */
function dateGrouping(col: Column, maxBuckets: number): DateGrouping | null {
  if (hasAny(col.words, META_DATE_WORDS)) return null;
  const parts = col.values.map(parseDateParts).filter((p) => p !== null);
  if (parts.length < col.values.length / 2) return null;
  for (const [group, bucket] of DATE_LADDER) {
    // Trim the outer 1% so a stray 1970-01-01 or 9999-12-31 doesn't stretch the range.
    const buckets = parts.map(bucket).sort((a, b) => a - b);
    const trim = Math.floor(buckets.length * 0.01);
    const span = buckets[buckets.length - 1 - trim] - buckets[trim] + 1;
    if (span < 2) return null;
    if (span <= maxBuckets) return group;
  }
  return null;
}

/** Rank of a column worth summing (lower is better), or null. */
function measureRank(col: Column): number | null {
  if (hasAny(col.words, ID_WORDS) || hasAny(col.words, NOT_MEASURE_WORDS)) return null;
  const isCount = col.words.length === 1 && col.words[0] === "count";
  const rank = isCount ? 0 : Math.min(...col.words.map((w) => MEASURE_WORDS.indexOf(w)).filter((i) => i >= 0));
  if (!Number.isFinite(rank)) return null;
  const numbers = col.values.map(toNumber).filter((n) => !isNaN(n));
  if (numbers.length < col.values.length / 2) return null;
  // 0/1 flags stored as integers.
  if (numbers.every((n) => n === 0 || n === 1)) return null;
  return rank;
}

function sample(rows: CellValue[][]): CellValue[][] {
  if (rows.length <= SAMPLE_ROWS) return rows;
  const step = rows.length / SAMPLE_ROWS;
  return Array.from({ length: SAMPLE_ROWS }, (_, i) => rows[Math.floor(i * step)]);
}

/**
 * Pick a starting pivot for a dataset: a category-like column in rows, an
 * event date grouped into a readable number of buckets in columns (or in rows
 * when there's no category), and the sum of an amount-like column, falling
 * back to a row count. Columns that make an odd pivot (ids, mostly empty
 * columns, free text, timestamps like `updated_at`) are skipped.
 */
export function suggestConfig(dataset: Dataset): PivotConfig {
  const config = defaultConfig();
  const rows = sample(dataset.rows);
  const columns = (...types: ColumnType[]): Column[] =>
    dataset.columns
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => types.includes(c.type))
      .map(({ c, i }) => ({ name: c.name, words: nameWords(c.name), values: rows.map((r) => r[i]) }));

  // Ties go to the column that comes first.
  let measure: { name: string; rank: number } | null = null;
  for (const col of columns("number")) {
    const rank = measureRank(col);
    if (rank !== null && (!measure || rank < measure.rank)) measure = { name: col.name, rank };
  }
  let dimension: { name: string; score: number } | null = null;
  for (const col of columns("string", "boolean")) {
    const score = dimensionScore(col, measure !== null);
    if (score !== null && (!dimension || score > dimension.score)) dimension = { name: col.name, score };
  }
  if (dimension) config.rows = [dimension.name];

  const dateRank = (c: Column) => (hasAny(c.words, EVENT_DATE_WORDS) ? 2 : hasAny(c.words, DATE_WORDS) ? 1 : 0);
  for (const col of columns("date").sort((a, b) => dateRank(b) - dateRank(a))) {
    const group = dateGrouping(col, dimension ? MAX_DATE_COLS : MAX_DATE_ROWS);
    if (!group) continue;
    (dimension ? config.cols : config.rows).push(col.name);
    config.fieldOptions[col.name] = { dateGroup: group };
    break;
  }

  config.values = [makeValue(dataset, measure?.name ?? null)];
  return config;
}
