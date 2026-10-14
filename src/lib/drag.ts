import { reactive } from "vue";
import { DRAG_MIME, type DragPayload } from "./state";

/**
 * The payload of the drag in progress. `dataTransfer` data can't be read
 * during `dragover`, so drop zones look here instead.
 */
export const dragState = reactive<{ payload: DragPayload | null }>({ payload: null });

export function startDrag(e: DragEvent, payload: DragPayload, label: string) {
  dragState.payload = payload;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
    e.dataTransfer.setData("text/plain", label);
  }
}

export function endDrag() {
  dragState.payload = null;
}
