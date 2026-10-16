import { describe, expect, it } from "vitest";
import { buildDataset } from "../src/lib/source/dataset";
import { nameWords, suggestConfig } from "../src/lib/suggest";
import type { Dataset, PivotConfig } from "../src/lib/pivot/types";
import { sales } from "./fixtures";

let seed = 7;
function rand() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
/** A date `days` after `start`, as Beekeeper shows it. */
function day(start: string, days: number, time = false): string {
  const d = new Date(Date.parse(`${start}T00:00:00Z`) + Math.floor(days) * 86_400_000);
  return d.toISOString().slice(0, 10) + (time ? " 12:30:00" : "");
}

function table(columns: Record<string, (i: number) => unknown>, count = 400, dbTypes: Record<string, string> = {}): Dataset {
  const names = Object.keys(columns);
  const rows = Array.from({ length: count }, (_, i) => names.map((n) => columns[n](i)));
  return buildDataset(
    names,
    rows,
    names.map((n) => dbTypes[n])
  );
}

const layout = (c: PivotConfig) => ({
  rows: c.rows,
  cols: c.cols,
  groups: Object.fromEntries(Object.entries(c.fieldOptions).map(([f, o]) => [f, o.dateGroup])),
  values: c.values.map((v) => [v.field, v.agg]),
});

describe("nameWords", () => {
  it("splits snake, camel and spaced names", () => {
    expect(nameWords("order_status")).toEqual(["order", "status"]);
    expect(nameWords("orderStatus")).toEqual(["order", "status"]);
    expect(nameWords("CustomerID")).toEqual(["customer", "id"]);
    expect(nameWords("HTTPStatus")).toEqual(["http", "status"]);
    expect(nameWords("Order Date")).toEqual(["order", "date"]);
    expect(nameWords("count(*)")).toEqual(["count"]);
  });
});

describe("suggestConfig", () => {
  it("lays out the sample sales data as amount by region and quarter", () => {
    expect(layout(suggestConfig(sales))).toEqual({
      rows: ["region"],
      cols: ["sold_at"],
      groups: { sold_at: "quarter" },
      values: [["amount", "sum"]],
    });
  });

  it("skips ids, flags, mostly empty columns and bookkeeping timestamps on a users table", () => {
    const users = table(
      {
        id: (i) => i + 1,
        email: (i) => `user${i}@example.com`,
        name: (i) => `User ${i}`,
        is_admin: (i) => i < 3,
        reset_token: (i) => (i === 5 ? "abc123" : null),
        tenant_id: (i) => (i % 2 ? "6f1c" : "9a2e"),
        plan: () => pick(["free", "pro", "team"]),
        country: () => pick(["US", "DE", "FR", "GB", "IN", "BR"]),
        sign_in_count: () => Math.floor(rand() * 50),
        created_at: (i) => day("2023-01-01", i * 1.8, true),
        updated_at: (i) => day("2024-06-01", i % 3, true),
      },
      400,
      { id: "int4", is_admin: "bool", sign_in_count: "int4", created_at: "timestamp", updated_at: "timestamp" }
    );
    expect(layout(suggestConfig(users))).toEqual({
      rows: ["plan"],
      cols: ["created_at"],
      groups: { created_at: "quarter" },
      values: [[null, "count"]],
    });
  });

  it("sums the order total, not the unit price or quantity", () => {
    const orders = table({
      id: (i) => i + 1,
      customer_id: () => Math.floor(rand() * 100),
      status: () => pick(["pending", "paid", "shipped", "refunded"]),
      unit_price: () => pick([9.99, 19.99, 49]),
      quantity: () => 1 + Math.floor(rand() * 5),
      total: () => Math.round(rand() * 20000) / 100,
      placed_at: (i) => day("2024-01-01", i * 0.4),
      updated_at: (i) => day("2024-01-01", i * 0.4),
    });
    expect(layout(suggestConfig(orders))).toEqual({
      rows: ["status"],
      cols: ["placed_at"],
      groups: { placed_at: "month" },
      values: [["total", "sum"]],
    });
  });

  it("puts the date in rows when there's no category to group by", () => {
    const payments = table({
      payment_id: (i) => i + 1,
      customer_id: () => Math.floor(rand() * 500),
      staff_id: () => pick([1, 2]),
      amount: () => pick([0.99, 2.99, 4.99]),
      payment_date: (i) => day("2024-02-01", i * 0.3, true),
    });
    expect(layout(suggestConfig(payments))).toEqual({
      rows: ["payment_date"],
      cols: [],
      groups: { payment_date: "month" },
      values: [["amount", "sum"]],
    });
  });

  it("falls back to a row count when nothing groups well", () => {
    const contacts = table({
      id: (i) => i,
      name: (i) => `Contact ${i}`,
      email: (i) => `c${i}@example.com`,
      notes: (i) => `Met at conference ${i}`,
    });
    expect(layout(suggestConfig(contacts))).toEqual({ rows: [], cols: [], groups: {}, values: [[null, "count"]] });
  });

  it("keeps the group of a GROUP BY result", () => {
    const grouped = buildDataset(
      ["status", "count"],
      [
        ["pending", 12],
        ["paid", 40],
        ["shipped", 31],
        ["refunded", 3],
      ],
      ["varchar", "int8"]
    );
    expect(layout(suggestConfig(grouped))).toEqual({ rows: ["status"], cols: [], groups: {}, values: [["count", "sum"]] });
  });

  it("prefers a named category over a two-value flag or long text", () => {
    const tickets = table({
      urgent: (i) => i % 2 === 0,
      summary: () => pick(["The export button does nothing when the table is empty", "Login page times out after a minute"]),
      kind: () => pick(["bug", "question", "feature", "billing"]),
    });
    expect(suggestConfig(tickets).rows).toEqual(["kind"]);
  });

  it("skips JSON columns and 0/1 flags stored as numbers", () => {
    const events = table(
      {
        payload: () => ({ kind: pick(["a", "b"]) }),
        tags: () => [pick(["x", "y"])],
        paid: () => pick([0, 1]),
      },
      100,
      { paid: "tinyint" }
    );
    expect(layout(suggestConfig(events))).toEqual({ rows: [], cols: [], groups: {}, values: [[null, "count"]] });
  });

  it("groups dates by the span of the data, ignoring stray outliers", () => {
    const span = (days: number, extra: Record<string, (i: number) => unknown> = {}) =>
      table({ region: () => pick(["North", "South"]), ordered_on: (i) => (i === 0 ? "1970-01-01" : day("2020-01-01", (i * days) / 400)), ...extra });
    expect(suggestConfig(span(9)).fieldOptions.ordered_on?.dateGroup).toBe("day");
    expect(suggestConfig(span(300)).fieldOptions.ordered_on?.dateGroup).toBe("month");
    expect(suggestConfig(span(900)).fieldOptions.ordered_on?.dateGroup).toBe("quarter");
    expect(suggestConfig(span(2500)).fieldOptions.ordered_on?.dateGroup).toBe("year");
    // Too many years to fit across the top.
    expect(suggestConfig(span(365 * 30)).cols).toEqual([]);
  });

  it("prefers an event date over other dates", () => {
    const rentals = table({
      genre: () => pick(["Drama", "Comedy", "Horror"]),
      return_date: (i) => day("2024-03-01", i * 0.5),
      rental_date: (i) => day("2024-01-01", i * 0.5),
      last_update: () => "2024-06-01 10:00:00",
    });
    expect(layout(suggestConfig(rentals))).toEqual({
      rows: ["genre"],
      cols: ["rental_date"],
      groups: { rental_date: "month" },
      values: [[null, "count"]],
    });
  });
});
