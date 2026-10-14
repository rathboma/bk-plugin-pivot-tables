<script setup lang="ts">
import { computed, ref } from "vue";
import { fieldCaption, valueCaption } from "../lib/pivot/format";
import type { ColumnType, PivotConfig, ValueField } from "../lib/pivot/types";
import { dragState, endDrag, startDrag } from "../lib/drag";
import type { DragPayload, Zone } from "../lib/state";
import Icon from "./Icon.vue";

const props = defineProps<{
  zone: Zone;
  title: string;
  icon: string;
  hint: string;
  config: PivotConfig;
  types: Record<string, ColumnType>;
}>();
const emit = defineEmits<{
  drop: [payload: DragPayload, index: number];
  openField: [field: string, el: HTMLElement];
  openValue: [value: ValueField, el: HTMLElement];
}>();

interface Chip {
  key: string;
  label: string;
  field: string | null;
  value?: ValueField;
  filtered: boolean;
  type?: ColumnType;
}

const chips = computed<Chip[]>(() => {
  if (props.zone === "values") {
    return props.config.values.map((v) => ({
      key: v.id,
      label: valueCaption(v),
      field: v.field,
      value: v,
      filtered: false,
    }));
  }
  return props.config[props.zone].map((f) => ({
    key: f,
    label: fieldCaption(f, props.config),
    field: f,
    filtered: (props.config.fieldOptions[f]?.exclude?.length ?? 0) > 0,
    type: props.types[f],
  }));
});

const listEl = ref<HTMLElement | null>(null);
const insertAt = ref<number | null>(null);

function indexFromPoint(e: DragEvent): number {
  const els = listEl.value ? Array.from(listEl.value.querySelectorAll<HTMLElement>(".chip")) : [];
  for (let i = 0; i < els.length; i++) {
    const r = els[i].getBoundingClientRect();
    if (e.clientY < r.top) return i;
    if (e.clientY <= r.bottom && e.clientX < r.left + r.width / 2) return i;
  }
  return els.length;
}

function onDragOver(e: DragEvent) {
  if (!dragState.payload) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  insertAt.value = indexFromPoint(e);
}

function onDrop(e: DragEvent) {
  const payload = dragState.payload;
  if (!payload) return;
  e.preventDefault();
  const index = indexFromPoint(e);
  insertAt.value = null;
  endDrag();
  emit("drop", payload, index);
}

function onDragStart(e: DragEvent, chip: Chip) {
  startDrag(e, { field: chip.field, from: props.zone, valueId: chip.value?.id }, chip.label);
}

function open(chip: Chip, e: MouseEvent) {
  const el = (e.currentTarget as HTMLElement).closest(".chip") as HTMLElement;
  if (chip.value) emit("openValue", chip.value, el);
  else if (chip.field) emit("openField", chip.field, el);
}

const typeIcon = (t?: ColumnType) => (t ? t : "string");
</script>

<template>
  <section
    class="zone"
    :class="{ 'drag-active': !!dragState.payload, 'drag-over': insertAt !== null }"
    :data-zone="zone"
    @dragover="onDragOver"
    @dragleave.self="insertAt = null"
    @drop="onDrop"
  >
    <header class="zone-title">
      <Icon :name="icon" :size="14" />
      <span>{{ title }}</span>
    </header>
    <div ref="listEl" class="zone-list" @dragleave.self="insertAt = null">
      <template v-for="(chip, i) in chips" :key="chip.key">
        <span v-if="insertAt === i" class="insert-marker" />
        <div
          class="chip"
          :class="{ 'chip-value': zone === 'values', filtered: chip.filtered }"
          draggable="true"
          :title="chip.label"
          @dragstart="onDragStart($event, chip)"
          @dragend="endDrag(); insertAt = null"
          @click="open(chip, $event)"
        >
          <Icon v-if="zone !== 'values'" class="chip-icon" :name="typeIcon(chip.type)" :size="13" />
          <span class="chip-label">{{ chip.label }}</span>
          <Icon v-if="chip.filtered" class="chip-filter" name="filter" :size="12" />
          <Icon class="chip-caret" name="chevron" :size="14" />
        </div>
      </template>
      <span v-if="insertAt === chips.length && chips.length" class="insert-marker" />
      <div v-if="!chips.length" class="zone-empty">{{ hint }}</div>
    </div>
  </section>
</template>
