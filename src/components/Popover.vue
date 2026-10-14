<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{ open: boolean; anchor: HTMLElement | null; align?: "start" | "end"; width?: number }>(),
  { align: "start", width: 260 }
);
const emit = defineEmits<{ close: [] }>();

const panel = ref<HTMLElement | null>(null);
const style = ref<Record<string, string>>({});

function position() {
  if (!props.anchor || !panel.value) return;
  const a = props.anchor.getBoundingClientRect();
  const p = panel.value.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = props.align === "end" ? a.right - p.width : a.left;
  left = Math.max(6, Math.min(left, vw - p.width - 6));
  let top = a.bottom + 4;
  if (top + p.height > vh - 6 && a.top - p.height - 4 > 6) top = a.top - p.height - 4;
  top = Math.max(6, Math.min(top, vh - p.height - 6));
  style.value = { left: `${left}px`, top: `${top}px`, width: `${props.width}px` };
}

function onDocMouseDown(e: MouseEvent) {
  const t = e.target as Node;
  if (panel.value?.contains(t) || props.anchor?.contains(t)) return;
  emit("close");
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") emit("close");
}

function bind(on: boolean) {
  if (on) {
    document.addEventListener("mousedown", onDocMouseDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", position);
  } else {
    document.removeEventListener("mousedown", onDocMouseDown, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", position);
  }
}

watch(
  () => props.open,
  async (open) => {
    bind(open);
    if (open) {
      style.value = { left: "-9999px", top: "0px", width: `${props.width}px` };
      await nextTick();
      position();
    }
  },
  { immediate: true }
);

onBeforeUnmount(() => bind(false));
defineExpose({ position });
</script>

<template>
  <Teleport to="body">
    <div v-if="open" ref="panel" class="popover" :style="style" role="dialog">
      <slot />
    </div>
  </Teleport>
</template>

<style scoped>
.popover {
  position: fixed;
  z-index: 1000;
  max-height: calc(100vh - 12px);
  overflow: auto;
  background: var(--menu-bg);
  color: var(--text-dark);
  border-radius: 6px;
  box-shadow: var(--menu-shadow);
  padding: 6px 0;
  font-size: 12.5px;
}
</style>
