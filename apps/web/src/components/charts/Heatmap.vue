<script setup lang="ts">
/** Busy-hours heatmap: 7 days by 24 hours on a colour ramp, with a live caption on hover, a legend and the peak hour called out. */
import { computed, ref } from 'vue'

const props = defineProps<{ matrix: number[][] }>()
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const max = computed(() => Math.max(1, ...props.matrix.flat()))
const peak = computed(() => {
  let best = { d: 0, h: 0, n: -1 }
  props.matrix.forEach((row, d) => row.forEach((n, h) => { if (n > best.n) best = { d, h, n } }))
  return best
})
const hour = (h: number): string => `${String(h).padStart(2, '0')}:00`
const active = ref<{ d: number; h: number } | null>(null)
const caption = computed(() => {
  const a = active.value
  if (a) return `${DAYS[a.d]} ${hour(a.h)}: ${props.matrix[a.d]?.[a.h] ?? 0} calls`
  return peak.value.n > 0 ? `Busiest: ${DAYS[peak.value.d]} ${hour(peak.value.h)} with ${peak.value.n} calls` : 'No calls in this window'
})
/** Colour steps: empty is a faint wash, then the accent deepens toward the text colour at the peak. */
const tone = (n: number): string => {
  if (!n) return 'color-mix(in srgb, var(--text) 5%, transparent)'
  const f = n / max.value
  return `color-mix(in srgb, color-mix(in srgb, var(--accent) ${Math.round(28 + f * 72)}%, transparent) ${Math.round(100 - f * 28)}%, var(--text) ${Math.round(f * f * 34)}%)`
}
</script>

<template>
  <div class="hm2" role="img" :aria-label="caption" @pointerleave="active = null">
    <p class="hm2-cap" aria-live="polite">{{ caption }}</p>
    <div class="hm2-grid">
      <template v-for="(row, d) in matrix" :key="d">
        <span class="hm2-d">{{ DAYS[d] }}</span>
        <i v-for="(n, h) in row" :key="h" :class="{ pk: d === peak.d && h === peak.h && n > 0 }" :style="{ background: tone(n) }" @pointerenter="active = { d, h }" @pointerdown="active = { d, h }"></i>
      </template>
      <span></span><span v-for="h in 24" :key="h" class="hm2-h">{{ (h - 1) % 6 === 0 ? String(h - 1).padStart(2, '0') : '' }}</span>
    </div>
    <div class="hm2-legend"><span>Quiet</span><i></i><span>Busy</span></div>
  </div>
</template>

<style scoped>
.hm2-cap { margin: 0 0 var(--sp-2); font-size: var(--fs-sm); color: var(--text); min-height: 1.3em; }
.hm2-grid { display: grid; grid-template-columns: 28px repeat(24, 1fr); gap: 3px; align-items: center; }
.hm2-grid i { aspect-ratio: 1; border-radius: 4px; cursor: pointer; transition: transform var(--dur-fast) var(--ease-spring), box-shadow var(--dur-fast); }
.hm2-grid i:hover { transform: scale(1.35); box-shadow: 0 2px 8px color-mix(in srgb, var(--text) 30%, transparent); z-index: 1; position: relative; }
.hm2-grid i.pk { outline: 2px solid var(--text); outline-offset: 1px; }
.hm2-d, .hm2-h { color: var(--text-muted); font-size: 10px; }
.hm2-h { text-align: center; overflow: visible; white-space: nowrap; }
.hm2-legend { display: flex; align-items: center; gap: var(--sp-2); margin-top: var(--sp-3); color: var(--text-muted); font-size: var(--fs-xs); }
.hm2-legend i { flex: 0 0 120px; height: 8px; border-radius: var(--r-pill); background: linear-gradient(90deg, color-mix(in srgb, var(--text) 6%, transparent), color-mix(in srgb, var(--accent) 60%, transparent), color-mix(in srgb, var(--accent) 70%, var(--text))); }
</style>
