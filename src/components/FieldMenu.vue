<script setup lang="ts">
import { computed } from "vue";
import type { DistinctValue } from "../lib/pivot/engine";
import { DATE_GROUPINGS } from "../lib/pivot/format";
import type { ColumnType, DateGrouping, FieldOptions, SortOrder } from "../lib/pivot/types";
import type { Zone } from "../lib/state";
import Icon from "./Icon.vue";
import ValueFilter from "./ValueFilter.vue";

const props = defineProps<{
  field: string;
  type: ColumnType;
  zone: Zone | null;
  options: FieldOptions;
  distinct: DistinctValue[];
}>();
const emit = defineEmits<{
  update: [Partial<FieldOptions>];
  move: [Zone];
  remove: [];
}>();

const SORTS: { id: SortOrder; label: string }[] = [
  { id: "asc", label: "A → Z" },
  { id: "desc", label: "Z → A" },
  { id: "valueDesc", label: "Largest value first" },
  { id: "valueAsc", label: "Smallest value first" },
];

const sort = computed(() => props.options.sort ?? "asc");
const group = computed(() => props.options.dateGroup ?? "none");
const showGrouping = computed(() => props.type === "date" || group.value !== "none");
const moves = computed(() =>
  (
    [
      { id: "rows", label: "Rows", icon: "rows" },
      { id: "cols", label: "Columns", icon: "columns" },
      { id: "filters", label: "Filters", icon: "filter" },
      { id: "values", label: "Values", icon: "sigma" },
    ] as const
  ).filter((m) => m.id !== props.zone)
);

function setGroup(e: Event) {
  // Labels change with the grouping, so the old value filter no longer applies.
  emit("update", { dateGroup: (e.target as HTMLSelectElement).value as DateGrouping, exclude: [] });
}
</script>

<template>
  <div class="field-menu">
    <div class="menu-title" :title="field">{{ field }}</div>

    <template v-if="zone === 'rows' || zone === 'cols'">
      <div class="menu-section">Sort</div>
      <button
        v-for="s in SORTS"
        :key="s.id"
        type="button"
        class="menu-item"
        :class="{ checked: sort === s.id }"
        @click="emit('update', { sort: s.id })"
      >
        <span class="check"><Icon v-if="sort === s.id" name="boolean" :size="14" /></span>
        {{ s.label }}
      </button>
    </template>

    <template v-if="showGrouping">
      <div class="menu-section">Group dates by</div>
      <div class="menu-row">
        <select :value="group" @change="setGroup">
          <option v-for="g in DATE_GROUPINGS" :key="g.id" :value="g.id">{{ g.label }}</option>
        </select>
      </div>
    </template>

    <template v-if="zone && zone !== 'values'">
      <div class="menu-section">Show values</div>
      <ValueFilter
        :values="distinct"
        :excluded="options.exclude ?? []"
        @update:excluded="(exclude) => emit('update', { exclude })"
      />
    </template>

    <div class="menu-divider" />
    <button v-for="m in moves" :key="m.id" type="button" class="menu-item" @click="emit('move', m.id)">
      <span class="check"><Icon :name="m.icon" :size="14" /></span>
      {{ zone && m.id !== "values" ? "Move to" : "Add to" }} {{ m.label }}
    </button>
    <button v-if="zone" type="button" class="menu-item danger" @click="emit('remove')">
      <span class="check"><Icon name="close" :size="14" /></span>
      Remove
    </button>
  </div>
</template>
