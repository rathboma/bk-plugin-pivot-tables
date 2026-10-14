<script setup lang="ts">
import { computed, ref } from "vue";
import type { DistinctValue } from "../lib/pivot/engine";

const props = defineProps<{ values: DistinctValue[]; excluded: string[] }>();
const emit = defineEmits<{ "update:excluded": [string[]] }>();

const LIMIT = 500;
const query = ref("");
const excludedSet = computed(() => new Set(props.excluded));
const matches = computed(() => {
  const q = query.value.trim().toLowerCase();
  return q ? props.values.filter((v) => v.label.toLowerCase().includes(q)) : props.values;
});
const shown = computed(() => matches.value.slice(0, LIMIT));
const selectedCount = computed(() => props.values.length - props.excluded.filter((e) => props.values.some((v) => v.label === e)).length);

function toggle(label: string) {
  const next = new Set(props.excluded);
  if (next.has(label)) next.delete(label);
  else next.add(label);
  emit("update:excluded", [...next]);
}

/** Select or clear everything currently matching the search. */
function setAll(selected: boolean) {
  const next = new Set(props.excluded);
  for (const v of matches.value) {
    if (selected) next.delete(v.label);
    else next.add(v.label);
  }
  emit("update:excluded", [...next]);
}

function only(label: string) {
  emit(
    "update:excluded",
    props.values.filter((v) => v.label !== label).map((v) => v.label)
  );
}
</script>

<template>
  <div class="value-filter">
    <div class="vf-search">
      <input v-model="query" type="search" placeholder="Search values" spellcheck="false" />
    </div>
    <div class="vf-actions">
      <span class="muted">{{ selectedCount.toLocaleString() }} of {{ values.length.toLocaleString() }} shown</span>
      <span class="spacer" />
      <button class="link" type="button" @click="setAll(true)">All</button>
      <button class="link" type="button" @click="setAll(false)">None</button>
    </div>
    <ul class="vf-list">
      <li v-for="v in shown" :key="v.label" :title="v.label">
        <label>
          <input type="checkbox" :checked="!excludedSet.has(v.label)" @change="toggle(v.label)" />
          <span class="vf-label">{{ v.label }}</span>
        </label>
        <button class="link only" type="button" title="Show only this value" @click="only(v.label)">only</button>
        <span class="vf-count">{{ v.count.toLocaleString() }}</span>
      </li>
      <li v-if="matches.length > LIMIT" class="muted vf-more">
        {{ (matches.length - LIMIT).toLocaleString() }} more. Search to narrow the list.
      </li>
      <li v-if="!matches.length" class="muted vf-more">No matching values</li>
    </ul>
  </div>
</template>

<style scoped>
.value-filter {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.vf-search {
  padding: 4px 10px;
}
.vf-search input {
  width: 100%;
}
.vf-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 10px 4px;
  font-size: 11.5px;
}
.spacer {
  flex: 1;
}
.vf-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 240px;
  overflow: auto;
}
.vf-list li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 1px 10px;
}
.vf-list li:hover {
  background: var(--hover-bg);
}
.vf-list label {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  cursor: pointer;
  padding: 2px 0;
}
.vf-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.only {
  visibility: hidden;
  font-size: 11px;
}
.vf-list li:hover .only {
  visibility: visible;
}
.vf-count {
  color: var(--text-light);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.vf-more {
  padding: 6px 10px !important;
  font-size: 11.5px;
}
</style>
