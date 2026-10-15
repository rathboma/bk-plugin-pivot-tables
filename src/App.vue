<script setup lang="ts">
import {
  addNotificationListener,
  appStorage,
  clipboard,
  getAppInfo,
  getConnectionInfo,
  getViewContext,
  getViewState,
  noty,
  setTabTitle,
  setViewState,
} from "@beekeeperstudio/plugin";
import { computed, markRaw, onMounted, ref, shallowRef, watch } from "vue";
import DropZone from "./components/DropZone.vue";
import FieldList from "./components/FieldList.vue";
import FieldMenu from "./components/FieldMenu.vue";
import Icon from "./components/Icon.vue";
import PivotTable from "./components/PivotTable.vue";
import Popover from "./components/Popover.vue";
import SourcePanel from "./components/SourcePanel.vue";
import ValueMenu from "./components/ValueMenu.vue";
import { COPY_FORMATS, EXPORT_FORMATS, copyPivot, exportPivot, type CopyFormat, type ExportFormat } from "./lib/export";
import { computePivot, distinctValues, sanitizeConfig } from "./lib/pivot/engine";
import { fieldCaption, valueCaption } from "./lib/pivot/format";
import { buildGrid } from "./lib/pivot/grid";
import type { ColumnType, Dataset, Decimals, FieldOptions, PivotConfig, ValueField } from "./lib/pivot/types";
import {
  describeSource,
  errorMessage,
  loadSource,
  sourceFromContext,
  type SelectionSource,
  type SourceSpec,
  type StoredSource,
} from "./lib/source/loader";
import {
  DEFAULT_MAX_ROWS,
  applyDrop,
  axisOf,
  clone,
  defaultConfig,
  newValueId,
  removeAndForget,
  suggestConfig,
  type DragPayload,
  type ViewState,
  type Zone,
} from "./lib/state";

const RENDER_ROWS = 500;
const RENDER_COLS = 300;

// ---------- state ----------
const dataset = shallowRef<Dataset | null>(null);
const truncated = ref(false);
const source = shallowRef<SourceSpec | null>(null);
const contextSelection = shallowRef<SelectionSource | null>(null);
const config = ref<PivotConfig>(defaultConfig());
const maxRows = ref(DEFAULT_MAX_ROWS);
const heatmap = ref(false);
const title = ref("");
const dialect = ref("postgresql");
const ready = ref(false);
const loading = ref(false);
const loadError = ref<string | null>(null);
const contextNotice = ref<string | null>(null);
const loadNote = ref<string | null>(null);
const lastSql = ref<string | null>(null);
const loadedAt = ref<Date | null>(null);
const editingSource = ref(false);
const needsRun = ref(false);
const rowLimit = ref(RENDER_ROWS);
const busy = ref(false);

// ---------- pivot ----------
const result = computed(() => (dataset.value ? markRaw(computePivot(dataset.value, config.value)) : null));
const grid = computed(() => (result.value ? markRaw(buildGrid(result.value)) : null));
const types = computed<Record<string, ColumnType>>(() =>
  Object.fromEntries((dataset.value?.columns ?? []).map((c) => [c.name, c.type]))
);
const showSourcePanel = computed(() => ready.value && !needsRun.value && (editingSource.value || !dataset.value));
const sourceName = computed(() => describeSource(source.value));
const defaultTitle = computed(() => (source.value ? `${sourceName.value} pivot` : "Pivot table"));
const displayTitle = computed(() => title.value.trim() || defaultTitle.value);
const isEmptyPivot = computed(() => !config.value.rows.length && !config.value.cols.length && !config.value.values.length);

watch(grid, () => (rowLimit.value = RENDER_ROWS));

// ---------- theme ----------
const themeStyle = document.createElement("style");
themeStyle.id = "app-theme";
document.head.prepend(themeStyle);
function applyTheme(theme: { cssString: string; type: string } | undefined) {
  if (!theme) return;
  themeStyle.textContent = `:root { ${theme.cssString} }`;
  document.documentElement.dataset.theme = theme.type;
}
addNotificationListener("themeChanged", (theme) => applyTheme(theme));

// ---------- persistence ----------
function storedSource(s: SourceSpec | null): StoredSource | null {
  if (!s) return null;
  if (s.kind === "selection") return { kind: "selection" };
  return clone(s);
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;
function persist() {
  if (!ready.value) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const state: ViewState & { title?: string } = {
      version: 1,
      source: storedSource(source.value),
      config: clone(config.value),
      maxRows: maxRows.value,
      heatmap: heatmap.value,
      title: title.value,
    };
    setViewState(state).catch(() => undefined);
  }, 400);
}
watch([config, heatmap, title], persist, { deep: true });

function updateTabTitle() {
  setTabTitle(title.value.trim() ? title.value.trim() : source.value ? `Pivot: ${sourceName.value}` : "Pivot Table").catch(
    () => undefined
  );
}
watch(title, updateTabTitle);

// ---------- loading ----------
function configFits(c: PivotConfig, ds: Dataset): boolean {
  const names = new Set(ds.columns.map((col) => col.name));
  const used = [...c.rows, ...c.cols, ...c.filters, ...c.values.map((v) => v.field).filter((f): f is string => f !== null)];
  if (!used.length) return c.values.length > 0;
  return used.some((f) => names.has(f));
}

async function load(spec: SourceSpec, rows: number) {
  loading.value = true;
  loadError.value = null;
  try {
    const res = await loadSource(spec, rows, dialect.value);
    if (!res.dataset.columns.length) throw new Error("The data has no columns.");
    config.value = configFits(config.value, res.dataset)
      ? sanitizeConfig(clone(config.value), res.dataset)
      : suggestConfig(res.dataset);
    dataset.value = markRaw(res.dataset);
    truncated.value = res.truncated;
    lastSql.value = res.sql ?? null;
    loadNote.value = res.note ?? null;
    loadedAt.value = new Date();
    source.value = spec;
    maxRows.value = rows;
    editingSource.value = false;
    needsRun.value = false;
    appStorage.setItem("maxRows", rows).catch(() => undefined);
    updateTabTitle();
    persist();
  } catch (e) {
    loadError.value = errorMessage(e);
    editingSource.value = true;
    needsRun.value = false;
  } finally {
    loading.value = false;
  }
}

function reload() {
  if (source.value) load(source.value, maxRows.value);
}

onMounted(async () => {
  getAppInfo()
    .then((info) => applyTheme(info.theme))
    .catch(() => undefined);
  const [ctx, conn, saved, prefRows] = await Promise.all([
    getViewContext().catch(() => null),
    getConnectionInfo().catch(() => null),
    getViewState<(ViewState & { title?: string }) | null>().catch(() => null),
    appStorage.getItem<number>("maxRows").catch(() => null),
  ]);
  dialect.value = conn?.databaseType || conn?.connectionType || "postgresql";
  const fromContext = sourceFromContext(ctx, dialect.value);
  if (fromContext.source?.kind === "selection") contextSelection.value = fromContext.source;
  contextNotice.value = fromContext.notice ?? null;

  let restoring = false;
  if (saved && saved.version === 1 && saved.config) {
    restoring = true;
    config.value = { ...defaultConfig(), ...saved.config };
    maxRows.value = saved.maxRows || DEFAULT_MAX_ROWS;
    heatmap.value = !!saved.heatmap;
    title.value = saved.title ?? "";
    const restored = saved.source?.kind === "selection" ? contextSelection.value : (saved.source as SourceSpec | null);
    source.value = restored ?? fromContext.source;
  } else {
    maxRows.value = typeof prefRows === "number" && prefRows > 0 ? prefRows : DEFAULT_MAX_ROWS;
    source.value = fromContext.source;
  }
  ready.value = true;
  updateTabTitle();

  if (!source.value) return;
  // Don't silently re-run arbitrary SQL when a saved tab is reopened.
  if (restoring && source.value.kind === "query") {
    needsRun.value = true;
    return;
  }
  await load(source.value, maxRows.value);
});

// ---------- editing ----------
function onDrop(zone: Zone | "fields", payload: DragPayload, index: number) {
  config.value = applyDrop(config.value, payload, zone, index, dataset.value);
}

function setFieldOptions(field: string, patch: Partial<FieldOptions>) {
  const next = clone(config.value);
  next.fieldOptions[field] = { ...(next.fieldOptions[field] ?? {}), ...patch };
  config.value = next;
}

function moveField(field: string, zone: Zone) {
  const from = axisOf(config.value, field) ?? "fields";
  const index = zone === "values" ? config.value.values.length : config.value[zone].length;
  config.value = applyDrop(config.value, { field, from }, zone, index, dataset.value);
  fieldMenu.value = null;
}

function removeField(field: string) {
  const next = clone(config.value);
  removeAndForget(next, field);
  config.value = next;
  fieldMenu.value = null;
}

function updateValue(id: string, patch: Partial<ValueField>) {
  const next = clone(config.value);
  next.values = next.values.map((v) => (v.id === id ? { ...v, ...patch } : v));
  config.value = next;
}

function removeValue(id: string) {
  const next = clone(config.value);
  next.values = next.values.filter((v) => v.id !== id);
  config.value = next;
  valueMenu.value = null;
}

function duplicateValue(id: string) {
  const next = clone(config.value);
  const i = next.values.findIndex((v) => v.id === id);
  if (i >= 0) next.values.splice(i + 1, 0, { ...next.values[i], id: newValueId() });
  config.value = next;
  valueMenu.value = null;
}

function swapAxes() {
  const next = clone(config.value);
  [next.rows, next.cols] = [next.cols, next.rows];
  config.value = next;
}

function setOption<K extends keyof PivotConfig>(key: K, value: PivotConfig[K]) {
  config.value = { ...clone(config.value), [key]: value };
}

function resetPivot() {
  if (dataset.value) config.value = suggestConfig(dataset.value);
}

// ---------- menus ----------
const fieldMenu = ref<{ field: string; el: HTMLElement } | null>(null);
const valueMenu = ref<{ id: string; el: HTMLElement } | null>(null);
const exportBtn = ref<HTMLElement | null>(null);
const copyBtn = ref<HTMLElement | null>(null);
const sqlBtn = ref<HTMLElement | null>(null);
const exportOpen = ref(false);
const copyOpen = ref(false);
const sqlOpen = ref(false);

const menuField = computed(() => fieldMenu.value?.field ?? null);
const menuGroup = computed(() => (menuField.value ? config.value.fieldOptions[menuField.value]?.dateGroup : undefined));
const menuDistinct = computed(() => {
  const field = menuField.value;
  if (!field || !dataset.value) return [];
  const group = menuGroup.value;
  return distinctValues(dataset.value, field, { ...defaultConfig(), fieldOptions: { [field]: { dateGroup: group } } });
});
const menuValue = computed(() => config.value.values.find((v) => v.id === valueMenu.value?.id) ?? null);

function openField(field: string, el: HTMLElement) {
  valueMenu.value = null;
  fieldMenu.value = fieldMenu.value?.field === field && fieldMenu.value.el === el ? null : { field, el };
}
function openValue(value: ValueField, el: HTMLElement) {
  fieldMenu.value = null;
  valueMenu.value = valueMenu.value?.id === value.id ? null : { id: value.id, el };
}

// ---------- export ----------
function filterSummary(): string {
  const parts: string[] = [];
  const fields = new Set([...config.value.rows, ...config.value.cols, ...config.value.filters]);
  for (const f of fields) {
    const ex = config.value.fieldOptions[f]?.exclude ?? [];
    if (!ex.length) continue;
    const shown = ex.slice(0, 3).join(", ");
    parts.push(`${fieldCaption(f, config.value)} excludes ${shown}${ex.length > 3 ? ` and ${ex.length - 3} more` : ""}`);
  }
  return parts.join("; ");
}

function exportSubtitle(): string {
  const ds = dataset.value;
  const parts = [`Source: ${sourceName.value}`];
  if (ds) parts.push(`${ds.rows.length.toLocaleString()} rows${truncated.value ? " (row limit reached)" : ""}`);
  const filters = filterSummary();
  if (filters) parts.push(`Filters: ${filters}`);
  parts.push(new Date().toLocaleString());
  return parts.join(" · ");
}

function exportContext() {
  const date = new Date().toISOString().slice(0, 10);
  return {
    meta: { title: displayTitle.value, subtitle: exportSubtitle() },
    dataset: dataset.value!,
    fileBase: `${displayTitle.value} ${date}`,
  };
}

async function doExport(format: ExportFormat) {
  exportOpen.value = false;
  if (!grid.value) return;
  busy.value = true;
  try {
    const out = await exportPivot(format, grid.value, exportContext());
    if (out.note) noty.info(out.note).catch(() => undefined);
  } catch (e) {
    noty.error(`Export failed: ${errorMessage(e)}`).catch(() => undefined);
  } finally {
    busy.value = false;
  }
}

async function doCopy(format: CopyFormat) {
  copyOpen.value = false;
  if (!grid.value) return;
  busy.value = true;
  try {
    const out = await copyPivot(format, grid.value, exportContext());
    noty.success(out.note ?? "Copied to clipboard").catch(() => undefined);
  } catch (e) {
    noty.error(`Copy failed: ${errorMessage(e)}`).catch(() => undefined);
  } finally {
    busy.value = false;
  }
}

async function copySql() {
  if (!lastSql.value) return;
  await clipboard.writeText(lastSql.value).catch(() => undefined);
  sqlOpen.value = false;
  noty.success("SQL copied").catch(() => undefined);
}

const SOURCE_ICONS = { query: "code", table: "table", selection: "selection" } as const;
const sourceIcon = computed(() => (source.value ? SOURCE_ICONS[source.value.kind] : "pivot"));
const sourceWhere = computed(() => (source.value?.kind === "table" ? source.value.where.trim() : ""));
const valuesSummary = computed(() => result.value?.values.map(valueCaption).join(", ") ?? "");
const DECIMALS: { id: Decimals; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: 0, label: "0" },
  { id: 1, label: "1" },
  { id: 2, label: "2" },
  { id: 3, label: "3" },
  { id: 4, label: "4" },
];
</script>

<template>
  <div class="app" :class="{ 'is-loading': loading }">
    <aside class="sidebar">
      <div class="source-card" :class="{ empty: !source }">
        <Icon :name="sourceIcon" :size="16" />
        <div class="source-info">
          <div class="source-name" :title="sourceName">{{ source ? sourceName : "No data loaded" }}</div>
          <div v-if="dataset" class="source-meta">
            {{ dataset.rows.length.toLocaleString() }} rows · {{ dataset.columns.length }} fields
            <span v-if="sourceWhere" class="badge" :title="`WHERE ${sourceWhere}`">filtered</span>
            <span v-if="truncated" class="badge warn" :title="`Only the first ${maxRows.toLocaleString()} rows were loaded`">
              limit reached
            </span>
          </div>
        </div>
        <button
          v-if="source && source.kind !== 'selection'"
          class="icon-btn"
          type="button"
          title="Reload data"
          :disabled="loading"
          @click="reload"
        >
          <Icon name="refresh" />
        </button>
        <button class="icon-btn" type="button" title="Change data source" @click="editingSource = true">
          <Icon name="edit" />
        </button>
      </div>

      <template v-if="dataset">
        <FieldList
          :columns="dataset.columns"
          :config="config"
          @open="openField"
          @remove="(p) => onDrop('fields', p, 0)"
        />
        <div class="zones">
          <DropZone
            zone="filters"
            title="Filters"
            icon="filter"
            hint="Drop fields to filter by"
            :config="config"
            :types="types"
            @drop="(p, i) => onDrop('filters', p, i)"
            @open-field="openField"
          />
          <DropZone
            zone="cols"
            title="Columns"
            icon="columns"
            hint="Drop fields here"
            :config="config"
            :types="types"
            @drop="(p, i) => onDrop('cols', p, i)"
            @open-field="openField"
          />
          <DropZone
            zone="rows"
            title="Rows"
            icon="rows"
            hint="Drop fields here"
            :config="config"
            :types="types"
            @drop="(p, i) => onDrop('rows', p, i)"
            @open-field="openField"
          />
          <DropZone
            zone="values"
            title="Values"
            icon="sigma"
            hint="Count of rows"
            :config="config"
            :types="types"
            @drop="(p, i) => onDrop('values', p, i)"
            @open-value="openValue"
          />
        </div>

        <details class="options">
          <summary><Icon name="tune" :size="14" /> Options</summary>
          <label class="opt"><input type="checkbox" :checked="config.rowTotals" @change="setOption('rowTotals', !config.rowTotals)" /> Totals column</label>
          <label class="opt"><input type="checkbox" :checked="config.colTotals" @change="setOption('colTotals', !config.colTotals)" /> Totals row</label>
          <label class="opt"><input type="checkbox" :checked="config.subtotals" @change="setOption('subtotals', !config.subtotals)" /> Subtotals</label>
          <label class="opt"><input v-model="heatmap" type="checkbox" /> Heatmap</label>
          <label class="opt">
            Values in
            <select :value="config.valuesOn" @change="setOption('valuesOn', ($event.target as HTMLSelectElement).value as 'rows' | 'cols')">
              <option value="cols">columns</option>
              <option value="rows">rows</option>
            </select>
          </label>
          <label class="opt">
            Decimals
            <select
              :value="String(config.decimals)"
              @change="
                setOption(
                  'decimals',
                  (($event.target as HTMLSelectElement).value === 'auto' ? 'auto' : Number(($event.target as HTMLSelectElement).value)) as Decimals
                )
              "
            >
              <option v-for="d in DECIMALS" :key="String(d.id)" :value="String(d.id)">{{ d.label }}</option>
            </select>
          </label>
          <button class="link reset" type="button" @click="resetPivot">Reset layout</button>
        </details>
      </template>
    </aside>

    <main class="main">
      <div class="toolbar">
        <input
          v-model="title"
          class="title-input"
          :placeholder="defaultTitle"
          spellcheck="false"
          aria-label="Pivot title"
          title="Title used for the tab and exports"
        />
        <span class="spacer" />
        <template v-if="grid && !showSourcePanel">
          <button class="btn ghost" type="button" title="Swap rows and columns" @click="swapAxes">
            <Icon name="swap" /> Swap
          </button>
          <button ref="copyBtn" class="btn" type="button" :disabled="busy" @click="copyOpen = !copyOpen">
            <Icon name="copy" /> Copy <Icon name="chevron" :size="14" />
          </button>
          <button ref="exportBtn" class="btn primary" type="button" :disabled="busy" @click="exportOpen = !exportOpen">
            <Icon name="download" /> Export <Icon name="chevron" :size="14" />
          </button>
        </template>
      </div>

      <div v-if="contextNotice && !showSourcePanel" class="notice info">
        <Icon name="info" :size="16" />
        <span>{{ contextNotice }}</span>
        <button class="icon-btn" type="button" title="Dismiss" @click="contextNotice = null"><Icon name="close" :size="14" /></button>
      </div>
      <div v-if="truncated && !showSourcePanel" class="notice warn">
        <Icon name="warning" :size="16" />
        <span>
          Showing the first {{ maxRows.toLocaleString() }} rows. Totals only cover the loaded rows.
          <button v-if="source?.kind !== 'selection'" class="link" type="button" @click="editingSource = true">Raise the limit</button>
        </span>
      </div>
      <div v-if="loadNote && !showSourcePanel" class="notice info">
        <Icon name="info" :size="16" />
        <span>{{ loadNote }}</span>
      </div>

      <div class="content">
        <div v-if="!ready" class="placeholder"><span class="spinner" /> Loading…</div>

        <div v-else-if="needsRun && source?.kind === 'query'" class="run-prompt">
          <h2>Run the query to rebuild this pivot</h2>
          <pre class="sql-preview">{{ source.sql }}</pre>
          <div class="row-actions">
            <button class="btn primary" type="button" @click="load(source!, maxRows)"><Icon name="play" :size="14" /> Run query</button>
            <button class="btn" type="button" @click="needsRun = false; editingSource = true">Edit query</button>
          </div>
        </div>

        <SourcePanel
          v-else-if="showSourcePanel"
          :source="source"
          :selection="contextSelection"
          :max-rows="maxRows"
          :busy="loading"
          :can-cancel="!!dataset"
          :error="loadError"
          @run="load"
          @cancel="editingSource = false; loadError = null"
        />

        <template v-else-if="grid">
          <div v-if="isEmptyPivot" class="notice hint-banner">
            <Icon name="info" :size="16" />
            <span>Drag fields from the left into Rows, Columns and Values to build the pivot.</span>
          </div>
          <PivotTable
            :grid="grid"
            :heatmap="heatmap"
            :row-limit="rowLimit"
            :col-limit="RENDER_COLS"
            @show-more="rowLimit += 1000"
          />
        </template>
        <div v-if="loading && dataset" class="loading-overlay"><span class="spinner" /></div>
      </div>

      <footer v-if="result && !showSourcePanel" class="statusbar">
        <span>{{ valuesSummary }}</span>
        <span class="sep">·</span>
        <span v-if="result.matchedRecords !== result.totalRecords">
          {{ result.matchedRecords.toLocaleString() }} of {{ result.totalRecords.toLocaleString() }} rows match filters
        </span>
        <span v-else>{{ result.totalRecords.toLocaleString() }} rows</span>
        <span class="sep">·</span>
        <span>{{ Math.max(result.rowKeys.length, 1).toLocaleString() }} × {{ Math.max(result.colKeys.length, 1).toLocaleString() }} groups</span>
        <span class="spacer" />
        <button v-if="lastSql" ref="sqlBtn" class="link" type="button" @click="sqlOpen = !sqlOpen">SQL</button>
        <span v-if="loadedAt" class="muted">Loaded {{ loadedAt.toLocaleTimeString() }}</span>
      </footer>
    </main>

    <Popover :open="!!fieldMenu" :anchor="fieldMenu?.el ?? null" :width="270" @close="fieldMenu = null">
      <FieldMenu
        v-if="fieldMenu"
        :field="fieldMenu.field"
        :type="types[fieldMenu.field] ?? 'string'"
        :zone="axisOf(config, fieldMenu.field)"
        :options="config.fieldOptions[fieldMenu.field] ?? {}"
        :distinct="menuDistinct"
        @update="(p) => setFieldOptions(fieldMenu!.field, p)"
        @move="(z) => moveField(fieldMenu!.field, z)"
        @remove="removeField(fieldMenu!.field)"
      />
    </Popover>

    <Popover :open="!!menuValue" :anchor="valueMenu?.el ?? null" :width="250" @close="valueMenu = null">
      <ValueMenu
        v-if="menuValue && dataset"
        :value="menuValue"
        :columns="dataset.columns"
        @update="(p) => updateValue(menuValue!.id, p)"
        @remove="removeValue(menuValue!.id)"
        @duplicate="duplicateValue(menuValue!.id)"
      />
    </Popover>

    <Popover :open="exportOpen" :anchor="exportBtn" align="end" :width="230" @close="exportOpen = false">
      <div class="menu-section">Save as</div>
      <button v-for="f in EXPORT_FORMATS" :key="f.id" type="button" class="menu-item" @click="doExport(f.id)">
        <span>{{ f.label }}</span>
        <span class="menu-hint">{{ f.hint }}</span>
      </button>
    </Popover>

    <Popover :open="copyOpen" :anchor="copyBtn" align="end" :width="230" @close="copyOpen = false">
      <button v-for="f in COPY_FORMATS" :key="f.id" type="button" class="menu-item" @click="doCopy(f.id)">
        <span>{{ f.label }}</span>
        <span class="menu-hint">{{ f.hint }}</span>
      </button>
    </Popover>

    <Popover :open="sqlOpen" :anchor="sqlBtn" align="end" :width="420" @close="sqlOpen = false">
      <div class="menu-section">SQL used to load the data</div>
      <pre class="sql-preview small">{{ lastSql }}</pre>
      <div class="menu-row"><button class="btn" type="button" @click="copySql"><Icon name="copy" /> Copy SQL</button></div>
    </Popover>
  </div>
</template>
