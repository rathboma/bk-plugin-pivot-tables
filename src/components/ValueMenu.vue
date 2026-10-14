<script setup lang="ts">
import { computed } from "vue";
import { AGGREGATORS } from "../lib/pivot/aggregators";
import { SHOW_AS } from "../lib/pivot/format";
import type { AggregatorId, DataColumn, ShowAs, ValueField } from "../lib/pivot/types";
import Icon from "./Icon.vue";

const props = defineProps<{ value: ValueField; columns: DataColumn[] }>();
const emit = defineEmits<{ update: [Partial<ValueField>]; remove: []; duplicate: [] }>();

const ROWS = "__rows__";
const column = computed(() => props.columns.find((c) => c.name === props.value.field));
const numeric = computed(() => column.value?.type === "number");
const aggregators = computed(() => (props.value.field === null ? AGGREGATORS.filter((a) => a.id === "count") : AGGREGATORS));
const percentAllowed = computed(() => AGGREGATORS.find((a) => a.id === props.value.agg)?.numericResult ?? false);

function setField(e: Event) {
  const v = (e.target as HTMLSelectElement).value;
  const field = v === ROWS ? null : v;
  const col = props.columns.find((c) => c.name === field);
  const patch: Partial<ValueField> = { field };
  if (field === null) patch.agg = "count";
  else if (props.value.field === null) patch.agg = col?.type === "number" ? "sum" : "count";
  emit("update", patch);
}

function setAgg(e: Event) {
  const agg = (e.target as HTMLSelectElement).value as AggregatorId;
  const patch: Partial<ValueField> = { agg };
  if (!AGGREGATORS.find((a) => a.id === agg)?.numericResult) patch.showAs = "value";
  emit("update", patch);
}
</script>

<template>
  <div class="field-menu">
    <div class="menu-section">Field</div>
    <div class="menu-row">
      <select :value="value.field ?? ROWS" @change="setField">
        <option :value="ROWS">(rows)</option>
        <option v-for="c in columns" :key="c.name" :value="c.name">{{ c.name }}</option>
      </select>
    </div>
    <div class="menu-section">Summarize by</div>
    <div class="menu-row">
      <select :value="value.agg" @change="setAgg">
        <option v-for="a in aggregators" :key="a.id" :value="a.id">
          {{ a.label }}{{ a.numeric && value.field !== null && !numeric ? " (numbers only)" : "" }}
        </option>
      </select>
    </div>
    <div class="menu-section">Show as</div>
    <div class="menu-row">
      <select
        :value="value.showAs"
        :disabled="!percentAllowed"
        @change="emit('update', { showAs: ($event.target as HTMLSelectElement).value as ShowAs })"
      >
        <option v-for="s in SHOW_AS" :key="s.id" :value="s.id">{{ s.label }}</option>
      </select>
    </div>
    <div class="menu-divider" />
    <button type="button" class="menu-item" @click="emit('duplicate')">
      <span class="check"><Icon name="add" :size="14" /></span>
      Duplicate
    </button>
    <button type="button" class="menu-item danger" @click="emit('remove')">
      <span class="check"><Icon name="close" :size="14" /></span>
      Remove
    </button>
  </div>
</template>
