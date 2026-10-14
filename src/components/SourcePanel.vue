<script setup lang="ts">
import { getTables } from "@beekeeperstudio/plugin";
import { computed, onMounted, ref, watch } from "vue";
import type { SelectionSource, SourceSpec } from "../lib/source/loader";
import { MAX_ROW_OPTIONS } from "../lib/state";
import Icon from "./Icon.vue";

const props = defineProps<{
  source: SourceSpec | null;
  selection: SelectionSource | null;
  maxRows: number;
  busy: boolean;
  canCancel: boolean;
  error: string | null;
}>();
const emit = defineEmits<{ run: [source: SourceSpec, maxRows: number]; cancel: [] }>();

type Mode = "query" | "table" | "selection";
const mode = ref<Mode>(props.source?.kind ?? (props.selection ? "selection" : "query"));
const sql = ref(props.source?.kind === "query" ? props.source.sql : "");
const tableLabel = ref("");
const where = ref(props.source?.kind === "table" ? props.source.where : "");
const rows = ref(props.maxRows);

interface TableOption {
  label: string;
  name: string;
  schema?: string;
}
const tables = ref<TableOption[]>([]);
const tablesError = ref<string | null>(null);

if (props.source?.kind === "table") {
  tableLabel.value = props.source.schema ? `${props.source.schema}.${props.source.table}` : props.source.table;
}

async function loadTables() {
  if (tables.value.length) return;
  try {
    const list = await getTables();
    tables.value = list
      .map((t) => ({ label: t.schema ? `${t.schema}.${t.name}` : t.name, name: t.name, schema: t.schema }))
      .sort((a, b) => a.label.localeCompare(b.label));
  } catch (e) {
    tablesError.value = "Couldn't list tables.";
  }
}

onMounted(() => {
  if (mode.value === "table") loadTables();
});
watch(mode, (m) => {
  if (m === "table") loadTables();
});

const selectedTable = computed<TableOption | null>(() => {
  const label = tableLabel.value.trim();
  if (!label) return null;
  const match = tables.value.find((t) => t.label === label) ?? tables.value.find((t) => t.name === label);
  if (match) return match;
  // Allow typing a table that isn't in the list (e.g. not loaded yet).
  const dot = label.lastIndexOf(".");
  return dot > 0 ? { label, schema: label.slice(0, dot), name: label.slice(dot + 1) } : { label, name: label };
});

const canRun = computed(() => {
  if (props.busy) return false;
  if (mode.value === "query") return sql.value.trim().length > 0;
  if (mode.value === "table") return !!selectedTable.value;
  return !!props.selection;
});

function run() {
  if (!canRun.value) return;
  let source: SourceSpec;
  if (mode.value === "query") source = { kind: "query", sql: sql.value };
  else if (mode.value === "table") {
    const t = selectedTable.value!;
    source = { kind: "table", table: t.name, schema: t.schema ?? null, where: where.value };
  } else source = props.selection!;
  emit("run", source, rows.value);
}

function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    run();
  }
}
</script>

<template>
  <div class="source-panel" @keydown="onKeydown">
    <div class="source-header">
      <h2>Data source</h2>
      <div class="segmented" role="tablist">
        <button v-if="selection" type="button" :class="{ active: mode === 'selection' }" @click="mode = 'selection'">
          <Icon name="selection" :size="14" /> Selection
        </button>
        <button type="button" :class="{ active: mode === 'query' }" @click="mode = 'query'">
          <Icon name="code" :size="14" /> Query
        </button>
        <button type="button" :class="{ active: mode === 'table' }" @click="mode = 'table'">
          <Icon name="table" :size="14" /> Table
        </button>
      </div>
    </div>

    <div v-if="mode === 'selection' && selection" class="source-body">
      <p class="muted">
        {{ selection.rows.length.toLocaleString() }} rows × {{ selection.columns.length }} columns selected in the
        result grid.
      </p>
    </div>

    <div v-else-if="mode === 'query'" class="source-body">
      <label class="field-label" for="pivot-sql">SQL query</label>
      <textarea
        id="pivot-sql"
        v-model="sql"
        class="sql"
        rows="8"
        spellcheck="false"
        placeholder="SELECT region, product, amount, sold_at FROM sales"
      />
      <p class="hint">A row limit is added automatically. Runs with Ctrl/Cmd+Enter.</p>
    </div>

    <div v-else class="source-body">
      <label class="field-label" for="pivot-table">Table</label>
      <input id="pivot-table" v-model="tableLabel" list="pivot-tables" placeholder="Pick or type a table" spellcheck="false" />
      <datalist id="pivot-tables">
        <option v-for="t in tables" :key="t.label" :value="t.label" />
      </datalist>
      <p v-if="tablesError" class="hint error-text">{{ tablesError }}</p>
      <label class="field-label" for="pivot-where">Filter (SQL WHERE clause, optional)</label>
      <textarea id="pivot-where" v-model="where" class="sql" rows="3" spellcheck="false" placeholder="status = 'shipped'" />
    </div>

    <div class="source-footer">
      <label class="rows-select">
        Max rows
        <select v-model.number="rows">
          <option v-for="n in MAX_ROW_OPTIONS" :key="n" :value="n">{{ n.toLocaleString() }}</option>
        </select>
      </label>
      <span class="spacer" />
      <button v-if="canCancel" type="button" class="btn" @click="emit('cancel')">Cancel</button>
      <button type="button" class="btn primary" :disabled="!canRun" @click="run">
        <Icon name="play" :size="14" />
        {{ busy ? "Loading…" : mode === "query" ? "Run query" : "Load data" }}
      </button>
    </div>
    <div v-if="error" class="notice error">
      <Icon name="warning" :size="16" />
      <pre>{{ error }}</pre>
    </div>
  </div>
</template>
