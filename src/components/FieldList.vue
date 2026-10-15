<script setup lang="ts">
import { computed, ref } from "vue";
import type { DataColumn, PivotConfig } from "../lib/pivot/types";
import { dragState, endDrag, startDrag } from "../lib/drag";
import { axisOf, type DragPayload } from "../lib/state";
import Icon from "./Icon.vue";

const props = defineProps<{ columns: DataColumn[]; config: PivotConfig }>();
const emit = defineEmits<{
  open: [field: string, el: HTMLElement];
  remove: [payload: DragPayload];
}>();

const query = ref("");
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return q ? props.columns.filter((c) => c.name.toLowerCase().includes(q)) : props.columns;
});

const ZONE_BADGE = { rows: "Rows", cols: "Columns", filters: "Filter" } as const;
const usage = (name: string) => {
  const axis = axisOf(props.config, name);
  const inValues = props.config.values.some((v) => v.field === name);
  const parts: string[] = [];
  if (axis) parts.push(ZONE_BADGE[axis]);
  if (inValues) parts.push("Values");
  return parts.join(" · ");
};

const removing = ref(false);
function onDragOver(e: DragEvent) {
  const p = dragState.payload;
  if (!p || p.from === "fields") return;
  e.preventDefault();
  removing.value = true;
}
function onDrop(e: DragEvent) {
  const p = dragState.payload;
  removing.value = false;
  if (!p || p.from === "fields") return;
  e.preventDefault();
  endDrag();
  emit("remove", p);
}
</script>

<template>
  <section
    class="fields"
    :class="{ removing }"
    @dragover="onDragOver"
    @dragleave.self="removing = false"
    @drop="onDrop"
  >
    <header class="zone-title">
      <Icon name="table" :size="14" />
      <span>Fields</span>
      <span class="count">{{ columns.length }}</span>
    </header>
    <div v-if="columns.length > 8" class="fields-search">
      <Icon name="search" :size="14" />
      <input v-model="query" type="search" placeholder="Find field" spellcheck="false" />
    </div>
    <div class="fields-list">
      <div
        v-for="c in filtered"
        :key="c.name"
        class="field"
        :class="{ used: !!usage(c.name) }"
        draggable="true"
        :title="`${c.name}${c.dbType ? ` (${c.dbType})` : ''}. Drag to Rows, Columns, Values or Filters.`"
        @dragstart="startDrag($event, { field: c.name, from: 'fields' }, c.name)"
        @dragend="endDrag()"
        @click="emit('open', c.name, $event.currentTarget as HTMLElement)"
      >
        <Icon class="field-type" :name="c.type" :size="13" />
        <span class="field-name">{{ c.name }}</span>
        <span v-if="usage(c.name)" class="field-usage">{{ usage(c.name) }}</span>
        <Icon class="field-add" name="add" :size="14" />
      </div>
      <div v-if="!filtered.length" class="zone-empty">No fields match</div>
    </div>
    <div v-if="removing" class="remove-hint">Drop to remove</div>
  </section>
</template>
