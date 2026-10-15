<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { GridCell, PivotGrid } from "../lib/pivot/grid";

const props = defineProps<{ grid: PivotGrid; heatmap: boolean; rowLimit: number; colLimit: number }>();
const emit = defineEmits<{ showMore: [] }>();

interface RenderCell {
  cell: GridCell;
  col: number;
  colSpan: number;
  rowSpan: number;
  heat?: number;
}

const maxCol = computed(() => Math.min(props.grid.width, props.colLimit));
const bodyCount = computed(() => Math.min(props.grid.bodyRowCount, props.rowLimit));

function renderRow(row: GridCell[], rowsLeft: number): RenderCell[] {
  const out: RenderCell[] = [];
  for (let c = 0; c < maxCol.value; c++) {
    const cell = row[c];
    if (cell.hidden) continue;
    out.push({
      cell,
      col: c,
      colSpan: Math.min(cell.colSpan, maxCol.value - c),
      rowSpan: Math.min(cell.rowSpan, rowsLeft),
    });
  }
  return out;
}

const headerRows = computed(() => props.grid.header.map((row, r) => renderRow(row, props.grid.headerRows - r)));

const bodyRows = computed(() => {
  const rows: RenderCell[][] = [];
  for (let i = 0; i < bodyCount.value; i++) rows.push(renderRow(props.grid.bodyRow(i, maxCol.value), bodyCount.value - i));
  if (props.heatmap) applyHeat(rows);
  return rows;
});

/** Colour leaf values by where they fall between the min and max of their value field. */
function applyHeat(rows: RenderCell[][]) {
  const min = new Map<number, number>();
  const max = new Map<number, number>();
  for (const row of rows) {
    for (const rc of row) {
      const { cell } = rc;
      if (cell.kind !== "data" || cell.total || typeof cell.value !== "number") continue;
      const vi = cell.valueIndex ?? 0;
      min.set(vi, Math.min(min.get(vi) ?? Infinity, cell.value));
      max.set(vi, Math.max(max.get(vi) ?? -Infinity, cell.value));
    }
  }
  for (const row of rows) {
    for (const rc of row) {
      const { cell } = rc;
      if (cell.kind !== "data" || cell.total || typeof cell.value !== "number") continue;
      const vi = cell.valueIndex ?? 0;
      const lo = min.get(vi)!;
      const hi = max.get(vi)!;
      rc.heat = hi === lo ? 0.5 : (cell.value - lo) / (hi - lo);
    }
  }
}

const R = computed(() => props.grid.rowHeaderCols);

function classes(rc: RenderCell, section: "head" | "body") {
  const { cell } = rc;
  return [
    `k-${cell.kind}`,
    cell.total ? `t-${cell.total}` : "",
    rc.col < R.value ? "sticky-col" : "",
    section === "head" ? "sticky-row" : "",
    rc.col + rc.colSpan === R.value ? "last-label" : "",
  ];
}

function styleFor(rc: RenderCell) {
  const s: Record<string, string> = {};
  if (rc.col < R.value) s.left = `var(--left-${rc.col}, 0px)`;
  if (rc.heat !== undefined) s.background = `color-mix(in srgb, var(--heat-color) ${Math.round(8 + rc.heat * 52)}%, var(--table-bg))`;
  return s;
}

const tooltip = (cell: GridCell) => (cell.text.length > 30 ? cell.text : undefined);

// ---- sticky offsets ----
const table = ref<HTMLTableElement | null>(null);
let ro: ResizeObserver | null = null;

function measure() {
  const t = table.value;
  if (!t) return;
  const headRows = Array.from(t.tHead?.rows ?? []);
  let top = 0;
  for (const tr of headRows) {
    tr.style.setProperty("--top", `${top}px`);
    top += tr.getBoundingClientRect().height;
  }
  const last = headRows[headRows.length - 1];
  if (!last) return;
  let left = 0;
  for (let j = 0; j < R.value; j++) {
    t.style.setProperty(`--left-${j}`, `${left}px`);
    const cell = last.cells[j];
    left += cell ? cell.getBoundingClientRect().width : 0;
  }
}

onMounted(() => {
  ro = new ResizeObserver(() => measure());
  if (table.value) ro.observe(table.value);
  nextTick(measure);
});
onBeforeUnmount(() => ro?.disconnect());
watch([headerRows, bodyRows], () => nextTick(measure));
</script>

<template>
  <div class="pivot-table-wrap">
    <table ref="table" class="pivot-table" :class="{ heatmap }">
      <thead>
        <tr v-for="(row, r) in headerRows" :key="`h${r}`">
          <th
            v-for="rc in row"
            :key="rc.col"
            :colspan="rc.colSpan > 1 ? rc.colSpan : undefined"
            :rowspan="rc.rowSpan > 1 ? rc.rowSpan : undefined"
            :class="classes(rc, 'head')"
            :style="styleFor(rc)"
            :title="tooltip(rc.cell)"
          >
            {{ rc.cell.text }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, i) in bodyRows" :key="i">
          <template v-for="rc in row" :key="rc.col">
            <td
              v-if="rc.cell.kind === 'data'"
              :class="classes(rc, 'body')"
              :style="styleFor(rc)"
              :title="tooltip(rc.cell)"
            >
              {{ rc.cell.text }}
            </td>
            <th
              v-else
              scope="row"
              :colspan="rc.colSpan > 1 ? rc.colSpan : undefined"
              :rowspan="rc.rowSpan > 1 ? rc.rowSpan : undefined"
              :class="classes(rc, 'body')"
              :style="styleFor(rc)"
              :title="tooltip(rc.cell)"
            >
              {{ rc.cell.text }}
            </th>
          </template>
        </tr>
      </tbody>
    </table>
    <div v-if="grid.bodyRowCount > bodyCount || grid.width > maxCol" class="render-limit">
      <span v-if="grid.bodyRowCount > bodyCount">
        Showing {{ bodyCount.toLocaleString() }} of {{ grid.bodyRowCount.toLocaleString() }} rows.
        <button class="link" type="button" @click="emit('showMore')">Show more</button>
      </span>
      <span v-if="grid.width > maxCol">
        Showing {{ (maxCol - R).toLocaleString() }} of {{ (grid.width - R).toLocaleString() }} columns. Try moving a field from
        Columns to Rows.
      </span>
      <span class="muted">Exports always include everything.</span>
    </div>
  </div>
</template>
