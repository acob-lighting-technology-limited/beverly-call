import { ref, type Ref } from 'vue'
import type { ViewMode } from '@/components/ViewToggle.vue'

const KEY = 'bc.views'

function read(): Record<string, ViewMode> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, ViewMode> } catch { return {} }
}

/** Card or table view for one data table, remembered per table id in this browser (a UI preference only). */
export function useViewMode(id: string, fallback: ViewMode = 'table'): { mode: Ref<ViewMode>; set: (v: ViewMode) => void } {
  const stored = read()[id]
  const mode = ref<ViewMode>(stored === 'cards' || stored === 'table' ? stored : fallback)
  function set(v: ViewMode): void {
    mode.value = v
    try { localStorage.setItem(KEY, JSON.stringify({ ...read(), [id]: v })) } catch { /* storage blocked */ }
  }
  return { mode, set }
}
