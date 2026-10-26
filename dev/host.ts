/**
 * A stand-in for Beekeeper Studio that hosts the plugin in an iframe and
 * answers its requests from an in-memory SQLite database (sql.js). Lets the
 * plugin be developed and tested in a plain browser: `yarn harness`.
 */
import initSqlJs, { type Database } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";

declare global {
  interface Window {
    __host: {
      saves: { fileName: string; encoding?: string; data: string }[];
      clipboard: { text?: string; image?: string };
      toasts: { type: string; message: string }[];
      queries: string[];
      viewState: unknown;
      title: string;
      ready: boolean;
    };
  }
}

const THEMES = {
  light: {
    type: "light",
    css: {
      "--font-family": "system-ui, -apple-system, 'Segoe UI', sans-serif",
      "--font-family-mono": "ui-monospace, Menlo, Consolas, monospace",
      "--theme-bg": "#f8f8f8",
      "--theme-base": "#000000",
      "--theme-primary": "#f5c90a",
      "--text-dark": "rgba(0,0,0,0.87)",
      "--text": "rgba(0,0,0,0.67)",
      "--text-light": "rgba(0,0,0,0.57)",
      "--text-lighter": "rgba(0,0,0,0.37)",
      "--brand-info": "#3498db",
      "--brand-warning": "#f39c12",
      "--brand-danger": "#e74c3c",
      "--border-color": "rgba(0,0,0,0.15)",
      "--link-color": "#2980b9",
      "--query-editor-bg": "#ffffff",
      "--menu-bg": "#ffffff",
      "--scrollbar-thumb": "rgba(0,0,0,0.2)",
    },
  },
  dark: {
    type: "dark",
    css: {
      "--font-family": "system-ui, -apple-system, 'Segoe UI', sans-serif",
      "--font-family-mono": "ui-monospace, Menlo, Consolas, monospace",
      "--theme-bg": "#252525",
      "--theme-base": "#ffffff",
      "--theme-primary": "#fad83b",
      "--text-dark": "rgba(255,255,255,0.87)",
      "--text": "rgba(255,255,255,0.67)",
      "--text-light": "rgba(255,255,255,0.57)",
      "--text-lighter": "rgba(255,255,255,0.37)",
      "--brand-info": "#4aa3df",
      "--brand-warning": "#f39c12",
      "--brand-danger": "#e74c3c",
      "--border-color": "rgba(255,255,255,0.1)",
      "--link-color": "#5dade2",
      "--query-editor-bg": "#1c1c1c",
      "--menu-bg": "#2f2f2f",
      "--scrollbar-thumb": "rgba(255,255,255,0.2)",
    },
  },
} as const;

type ThemeName = keyof typeof THEMES;

function theme(name: ThemeName) {
  const t = THEMES[name];
  return {
    type: t.type,
    palette: {},
    cssString: Object.entries(t.css)
      .map(([k, v]) => `${k}: ${v};`)
      .join(""),
  };
}

// ---------- sample data ----------
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function buildDatabase(SQL: Awaited<ReturnType<typeof initSqlJs>>): Database {
  const db = new SQL.Database();
  db.run(`CREATE TABLE orders (
    id INTEGER PRIMARY KEY, region TEXT, country TEXT, category TEXT, product TEXT,
    channel TEXT, customer TEXT, order_date TEXT, quantity INTEGER, unit_price REAL, amount REAL, returned INTEGER)`);
  const rand = seeded(42);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const regions = { North: ["Norway", "Sweden", "Finland"], South: ["Spain", "Italy", "Portugal"], East: ["Poland", "Romania"], West: ["France", "Ireland", "Belgium"] } as const;
  const products: Record<string, [string, number][]> = {
    Hardware: [["Keyboard", 49], ["Mouse", 25], ["Monitor", 229], ["Dock", 149]],
    Software: [["IDE license", 199], ["Backup suite", 89]],
    Services: [["Support plan", 499], ["Training", 899]],
  };
  const customers = ["Acme", "Globex", "Initech", "Umbrella", "Hooli", "Stark", "Wayne", "Wonka", "Cyberdyne", "Soylent", "Москва Ltd"];
  const stmt = db.prepare("INSERT INTO orders VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
  for (let i = 1; i <= 5000; i++) {
    const region = pick(Object.keys(regions) as (keyof typeof regions)[]);
    const category = pick(Object.keys(products));
    const [product, price] = pick(products[category]);
    const d = new Date(Date.UTC(2023, 0, 1) + Math.floor(rand() * 730) * 86400000);
    const qty = 1 + Math.floor(rand() * 10);
    stmt.run([
      i,
      region,
      pick(regions[region]),
      category,
      product,
      pick(["Online", "Retail", "Partner"]),
      pick(customers),
      `${d.toISOString().slice(0, 10)} ${String(Math.floor(rand() * 24)).padStart(2, "0")}:00:00`,
      qty,
      price,
      Math.round(qty * price * (0.85 + rand() * 0.3) * 100) / 100,
      rand() < 0.05 ? 1 : 0,
    ]);
  }
  stmt.free();
  return db;
}

function runSql(db: Database, sql: string) {
  const results = db.exec(sql);
  return results.map((r) => ({
    fields: r.columns.map((name, i) => ({ id: `c${i}`, name, dataType: undefined })),
    rows: r.values.map((row) => Object.fromEntries(row.map((v, i) => [`c${i}`, v]))),
    rowCount: r.values.length,
  }));
}

// ---------- host ----------
const QUERY = `-- revenue by region and product
SELECT region, country, category, product, channel, customer, order_date, quantity, amount, returned
FROM orders;`;

async function main() {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const db = buildDatabase(SQL);
  const iframe = document.getElementById("plugin") as HTMLIFrameElement;
  const commandSel = document.getElementById("command") as HTMLSelectElement;
  const themeSel = document.getElementById("theme") as HTMLSelectElement;
  const params = new URLSearchParams(location.search);
  if (params.get("command")) commandSel.value = params.get("command")!;
  if (params.get("theme")) themeSel.value = params.get("theme")!;

  const STATE_KEY = "pivot-dev-host-state";
  const storage = new Map<string, unknown>();
  window.__host = {
    saves: [],
    clipboard: {},
    toasts: [],
    queries: [],
    viewState: JSON.parse(localStorage.getItem(STATE_KEY) ?? "null"),
    title: "",
    ready: false,
  };

  function context() {
    switch (commandSel.value) {
      case "pivot-selection": {
        const [res] = runSql(db, "SELECT region, category, product, channel, order_date, amount FROM orders LIMIT 1200");
        const columns = res.fields.map((f) => f.name);
        const value = res.rows.map((r) => res.fields.map((f) => r[f.id]));
        return {
          command: "pivot-selection",
          params: {
            target: { type: "corner", rows: [], columns, value },
            activeRange: { rows: value.map((_, i) => i + 1), columns, value },
          },
        };
      }
      case "pivot-query":
        return { command: "pivot-query", params: { tab: { type: "query", id: 1, title: "Query #1", data: { query: QUERY, result: null } } } };
      case "pivot-table":
        return {
          command: "pivot-table",
          params: {
            tab: {
              type: "table",
              id: 2,
              title: "orders",
              data: {
                table: { name: "orders", schema: null, entityType: "table" },
                filters: [
                  { field: "returned", type: "=", value: "0" },
                  { field: "channel", type: "in", value: "Online, Retail", op: "AND" },
                ],
                result: null,
              },
            },
          },
        };
      case "pivot-results":
        return {
          command: "pivot-results",
          params: {
            source: "table",
            entity: { type: "table", name: "orders" },
            filters: [{ field: "returned", type: "=", value: "0" }],
            where: `"returned" = '0'`,
          },
        };
      default:
        return { command: "new-pivot" };
    }
  }

  function toast(type: string, message: string) {
    window.__host.toasts.push({ type, message });
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = message;
    document.getElementById("toasts")!.append(el);
    setTimeout(() => el.remove(), 4000);
  }

  async function handle(name: string, args: any): Promise<unknown> {
    switch (name) {
      case "getViewContext":
        return context();
      case "getConnectionInfo":
        return { id: 1, workspaceId: -1, connectionName: "Dev SQLite", connectionType: "sqlite", databaseType: "sqlite", databaseName: "dev", readOnlyMode: false };
      case "getAppInfo":
        return { version: "5.5.0", theme: theme(themeSel.value as ThemeName) };
      case "getViewState":
        return window.__host.viewState;
      case "setViewState":
        window.__host.viewState = args.state;
        localStorage.setItem(STATE_KEY, JSON.stringify(args.state));
        return;
      case "getData":
      case "getEncryptedData":
        return storage.get(args.key) ?? null;
      case "setData":
      case "setEncryptedData":
        storage.set(args.key, args.value);
        return;
      case "setTabTitle":
        window.__host.title = args.title;
        document.getElementById("title")!.textContent = `Tab: ${args.title}`;
        return;
      case "runQuery":
        window.__host.queries.push(args.query);
        await new Promise((r) => setTimeout(r, 150));
        return { results: runSql(db, args.query) };
      case "getTables":
        return runSql(db, "SELECT name FROM sqlite_master WHERE type = 'table'")[0].rows.map((r) => ({ name: r.c0 }));
      case "getSchemas":
        return [];
      case "requestFileSave": {
        window.__host.saves.push({ fileName: args.fileName, encoding: args.encoding, data: args.data });
        const bytes = args.encoding === "base64" ? Uint8Array.from(atob(args.data), (c) => c.charCodeAt(0)) : new TextEncoder().encode(args.data);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([bytes]));
        a.download = args.fileName;
        a.click();
        return;
      }
      case "clipboard.writeText":
        window.__host.clipboard.text = args.text;
        return;
      case "clipboard.writeImage":
        window.__host.clipboard.image = args.data;
        return;
      case "noty.success":
      case "noty.info":
      case "noty.warning":
      case "noty.error":
        toast(name.split(".")[1], args.message);
        return;
      case "confirm":
        return window.confirm(`${args.title ?? ""}\n\n${args.message ?? ""}`);
      default:
        throw new Error(`Unknown request: ${name}`);
    }
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== iframe.contentWindow) return;
    const { id, name, args } = event.data ?? {};
    if (!id || !name) return; // notifications (windowEvent etc.)
    const response: Record<string, unknown> = { id, name, args };
    try {
      response.result = await handle(name, args);
    } catch (e) {
      response.error = e instanceof Error ? { message: e.message } : e;
    }
    iframe.contentWindow!.postMessage(response, "*");
  });

  const load = () => {
    // ?prod=1 loads the production build (run `yarn build` first).
    iframe.src = `${params.get("prod") === "1" ? "/dist/index.html" : "/index.html"}?ts=${Date.now()}`;
  };
  iframe.addEventListener("load", () => {
    iframe.contentWindow!.postMessage({ name: "themeChanged", args: theme(themeSel.value as ThemeName) }, "*");
    window.__host.ready = true;
  });
  themeSel.addEventListener("change", () =>
    iframe.contentWindow!.postMessage({ name: "themeChanged", args: theme(themeSel.value as ThemeName) }, "*")
  );
  commandSel.addEventListener("change", () => {
    window.__host.viewState = null;
    localStorage.removeItem(STATE_KEY);
    load();
  });
  document.getElementById("reload")!.addEventListener("click", load);
  document.getElementById("clear")!.addEventListener("click", () => {
    window.__host.viewState = null;
    localStorage.removeItem(STATE_KEY);
    load();
  });
  if (params.get("fresh") === "1") {
    window.__host.viewState = null;
    localStorage.removeItem(STATE_KEY);
  }
  load();
}

main();
