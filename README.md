# Pivot Tables for Beekeeper Studio

Build pivot tables from query results, grid selections or whole tables in
[Beekeeper Studio](https://www.beekeeperstudio.io), then export them to Excel, PDF,
Markdown, CSV, HTML, JSON or a PNG image.

![Pivot table built from an orders query, with a heatmap](docs/screenshot.png)

## Features

- **Drag-and-drop builder** with Rows, Columns, Values and Filters, like a spreadsheet pivot table.
- **Aggregations:** count, count distinct, sum, average, minimum, maximum, median, standard
  deviation, variance, first and last. Several values can be shown side by side.
- **Show values as** a percentage of the grand total, row total or column total.
- **Date grouping** by year, quarter, month, ISO week, day, hour, month of year or day of week.
- **Value filters** with search, "only this value", and counts for each value.
- **Sorting** by label (A→Z, Z→A) or by value (largest or smallest first).
- **Layout options:** totals column, totals row, subtotals, values in columns or rows, fixed
  decimal places and a heatmap.
- **Exports:**
  - Excel (`.xlsx`): merged headers, number and percentage formats, frozen panes. The
    "Excel + source data" option adds a sheet with the loaded rows so they can be re-pivoted in Excel.
  - PDF: fits the page where it can and splits very wide pivots into column slices that repeat
    the row labels. Embeds a Unicode font when the data needs one (Cyrillic, Greek and more).
  - PNG image, Markdown, CSV, HTML and JSON.
- **Copy** for a spreadsheet (tab separated, pastes into Excel or Google Sheets), as Markdown, or
  as an image.
- Follows the app theme, and each tab saves its layout.

## Opening a pivot table

| Where                                                                  | Menu item                  | Data used                                             |
| ---------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------- |
| New tab dropdown (next to `+`), **Tools** menu                         | Pivot Table                | A query or table picked in the plugin                 |
| Query results or table data: right-click a cell or the top-left corner | Pivot Table from Selection | The selected cells                                    |
| Query tab header or the query editor's right-click menu                | Pivot Query Results        | The query, run again with a row limit                 |
| Table in the sidebar, or a table tab header                            | Open in Pivot Table        | The table, with the tab's filters as a `WHERE` clause |

To pivot a whole result set from the grid, select every cell first (click the top-left corner of
the grid or press Ctrl/Cmd+A), then right-click.

The data source can be changed at any time with the pencil button in the sidebar, which accepts a
SQL query or a table with an optional `WHERE` clause.

## Row limits

Pivots are calculated in the plugin, so the data is loaded with a row limit: 10,000 rows by
default, configurable up to 100,000 (the choice is remembered).

- Queries are wrapped as `SELECT * FROM (<query>) AS pivot_source LIMIT n` (`TOP` on SQL
  Server, `ROWNUM` on Oracle, `FIRST` on Firebird), so the database does the limiting.
- If the database rejects the wrapped query (for example a CTE on SQL Server), a prompt offers to
  run the query as written and keep the first rows. Statements that may change data are never
  re-run without confirmation.
- Databases without SQL subqueries (MongoDB, Redis, Cassandra and similar) run the query as
  written and keep the first rows.
- A banner shows when the limit was reached. Totals only cover the rows that were loaded.
- When a saved tab is reopened, query sources wait for a click on **Run query** instead of
  running automatically. Selections and tables load straight away.

## Installing

Once published, install **Pivot Tables** from **Tools → Manage Plugins** in Beekeeper Studio
(5.5 or newer).

To install a build manually, download `bk-plugin-pivot-tables-<version>.zip` from the
[releases](https://github.com/rathboma/bk-plugin-pivot-tables/releases) and extract it into
Beekeeper Studio's plugins directory:

- Linux: `~/.config/beekeeper-studio/plugins/bk-plugin-pivot-tables`
- macOS: `~/Library/Application Support/beekeeper-studio/plugins/bk-plugin-pivot-tables`
- Windows: `%APPDATA%\beekeeper-studio\plugins\bk-plugin-pivot-tables`

## Development

```bash
yarn install
yarn dev        # links the project into Beekeeper's plugins directory and serves it with hot reload
yarn harness    # runs the plugin in a browser against a fake Beekeeper Studio
yarn test:run   # unit tests (Vitest)
yarn typecheck
yarn build      # production build into dist/
yarn package    # release zip in release/ (after yarn build)
```

`yarn dev` uses [`@beekeeperstudio/vite-plugin`](https://www.npmjs.com/package/@beekeeperstudio/vite-plugin),
which symlinks the project into the plugins directory. Enable plugins in Beekeeper Studio, then
open a pivot from any of the menus above.

`yarn harness` serves `dev/host.html` at <http://localhost:5199/dev/host.html>. It hosts the
plugin in an iframe and answers its API requests from an in-memory SQLite database with 5,000
sample orders, so the UI and exports can be worked on without Beekeeper Studio. Query
parameters:

- `command=new-pivot|pivot-selection|pivot-query|pivot-table` picks the menu entry to emulate.
- `theme=light|dark` sets the theme.
- `fresh=1` clears the saved tab state.
- `prod=1` loads the production build from `dist/` (run `yarn build` first).

### Project layout

```
manifest.json            Plugin manifest: one view, menu entries for each way of opening it
src/App.vue              Startup, data loading, state persistence, export actions
src/components/          Field list, drop zones, menus, pivot table renderer, source editor
src/lib/pivot/           Pivot engine, aggregators, date grouping, grid layout (headers and spans)
src/lib/source/          Loading data: selections, queries and tables with dialect-aware row limits
src/lib/export/          Excel, PDF, image, Markdown, CSV, HTML and JSON exporters
tests/                   Vitest specs
dev/                     Browser harness that emulates Beekeeper Studio
```

The pivot engine produces a grid of cells with row and column spans
(`src/lib/pivot/grid.ts`). The on-screen table and every exporter render from that grid, so they
all show the same layout.

## Releasing

1. Update `version` in both `manifest.json` and `package.json`.
2. Commit, then tag and push: `git tag v1.0.0 && git push origin v1.0.0`.
3. The release workflow tests, builds and creates a **draft** GitHub release with `manifest.json`
   and `bk-plugin-pivot-tables-<version>.zip`. Review it and publish it.
4. For the Plugin Manager listing, add an entry to `plugins.json` in
   [beekeeper-studio-plugins](https://github.com/beekeeper-studio/beekeeper-studio-plugins).

## Limitations

- Table tab filters are passed to plugins by Beekeeper Studio builds that include the
  `serializeTab` filters change. Older versions open the whole table (with the row limit); a
  `WHERE` clause can still be typed in the source editor.
- The grid shows the first 500 rows and 300 columns of very large pivots ("Show more" loads more
  rows). Exports always include everything.
- Images include the first 2,000 rows.
- PDF exports can't draw CJK characters, which the embedded DejaVu font doesn't cover.

## License

GPL-3.0. Bundles the DejaVu fonts (Bitstream Vera license) for PDF exports.
