<script setup lang="ts">
/** Gradient bar chart with hover tooltip, average line, peak badge and an optional smoothed trend overlay.
 *  Used by: admin overview, analytics and reports. */
import { computed, ref } from 'vue'
import { movingAverage, niceMax, smoothPath, toPoints } from '@/lib/chart-math'

export interface Bar { label: string; value: number }
const props = withDefaults(defineProps<{
  items: Bar[]
  height?: number
  label?: string
  /** Draw a dashed average line. */
  average?: boolean
  /** Overlay a smoothed 3-point moving average. */
  trend?: boolean
  format?: (n: number) => string
  unit?: string
}>(), { height: 150, label: 'Bar chart', average: true, trend: false, unit: '', format: (n: number) => String(n) })

const max = computed(() => niceMax(Math.max(...props.items.map((b) => b.value), 1)))
const total = computed(() => props.items.reduce((a, b) => a + b.value, 0))
const avg = computed(() => (props.items.length ? total.value / props.items.length : 0))
const peak = computed(() => props.items.reduce((m, b, i, a) => (b.value > (a[m]?.value ?? 0) ? i : m), 0))
const trendPath = computed(() => {
  if (!props.trend || props.items.length < 3) return ''
  const vals = movingAverage(props.items.map((b) => b.value))
  // bars sit at (i + 0.5) / n of the width, so the line is plotted on the same centres
  const pts = toPoints(vals, max.value, 4).map((p, i) => ({ x: ((i + 0.5) / vals.length) * 100, y: p.y }))
  return smoothPath(pts)
})
const active = ref<number | null>(null)
const share = (v: number): string => (total.value ? `${Math.round((v / total.value) * 100)}% of total` : '')
const summary = computed(() => `${props.label}: ${props.items.length} values, peak ${props.format(props.items[peak.value]?.value ?? 0)}${props.unit} at ${props.items[peak.value]?.label ?? ''}`)
</script>

<template>
  <div class="bc" role="img" :aria-label="summary">
    <div class="bc-plot" :style="{ height: `${height}px` }" @pointerleave="active = null">
      <span class="bc-y bc-ymax">{{ format(max) }}</span>
      <div class="bc-grid" aria-hidden="true"><i></i><i></i><i></i></div>
      <div v-if="average && avg > 0" class="bc-avg" :style="{ bottom: `${(avg / max) * 100}%` }"><small>avg {{ format(Math.round(avg * 10) / 10) }}</small></div>
      <div class="bc-bars">
        <div v-for="(b, i) in items" :key="i" class="bc-col" :class="{ on: active === i }" @pointerenter="active = i" @pointerdown="active = i">
          <i class="bc-bar" :class="{ pk: i === peak && b.value > 0 }" :style="{ height: `${Math.max(2, (b.value / max) * 100)}%`, animationDelay: `${Math.min(i, 24) * 22}ms` }"></i>
          <span v-if="active === i" class="bc-tip"><small>{{ b.label }}</small><b>{{ format(b.value) }}{{ unit }}</b><small>{{ share(b.value) }}</small></span>
        </div>
      </div>
      <svg v-if="trendPath" class="bc-trend" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path :d="trendPath" fill="none" /></svg>
    </div>
    <div class="bc-lbl"><span v-for="(b, i) in items" :key="i" :class="{ on: active === i }">{{ items.length > 12 && i % Math.ceil(items.length / 8) ? '' : b.label }}</span></div>
  </div>
</template>

<style scoped>
.bc-plot { position: relative; padding-left: 30px; }
.bc-y { position: absolute; left: 0; font-size: 10px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.bc-ymax { top: -2px; }
.bc-grid { position: absolute; inset: 0 0 0 30px; display: grid; grid-template-rows: repeat(3, 1fr); pointer-events: none; }
.bc-grid i { border-top: 1px dashed var(--border); }
.bc-bars { position: absolute; inset: 0 0 0 30px; display: flex; align-items: flex-end; gap: 4px; }
.bc-col { position: relative; flex: 1; min-width: 0; height: 100%; display: flex; align-items: flex-end; cursor: pointer; }
.bc-bar { display: block; width: 100%; border-radius: 8px 8px 3px 3px; background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 80%, white), color-mix(in srgb, var(--accent) 35%, transparent)); transform-origin: bottom; animation: bc-grow 0.6s cubic-bezier(0.32, 0.72, 0, 1) both; transition: filter var(--dur-fast), transform var(--dur-fast); }
.bc-bar.pk { background: linear-gradient(180deg, var(--accent), color-mix(in srgb, var(--accent) 55%, var(--text))); box-shadow: 0 6px 16px color-mix(in srgb, var(--accent) 45%, transparent); }
.bc-col.on .bc-bar { filter: saturate(1.3) brightness(1.06); transform: scaleY(1.02); }
.bc-avg { position: absolute; left: 30px; right: 0; border-top: 1.5px dashed color-mix(in srgb, var(--text) 45%, transparent); pointer-events: none; }
.bc-avg small { position: absolute; right: 0; top: -15px; font-size: 10px; color: var(--text-muted); background: color-mix(in srgb, var(--surface) 80%, transparent); padding: 0 4px; border-radius: var(--r-pill); }
.bc-trend { position: absolute; inset: 0 0 0 30px; width: calc(100% - 30px); height: 100%; pointer-events: none; overflow: visible; }
.bc-trend path { stroke: var(--text); stroke-width: 2; stroke-linecap: round; opacity: 0.55; vector-effect: non-scaling-stroke; }
.bc-tip { position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%); display: grid; gap: 1px; padding: 6px 10px; border-radius: var(--r-md); background: var(--surface-inverse); color: var(--text-inverse); box-shadow: var(--sh-3); white-space: nowrap; pointer-events: none; z-index: 3; }
.bc-tip b { font-size: 16px; font-weight: var(--fw-medium); }
.bc-tip small { font-size: 10px; opacity: 0.75; }
.bc-col:first-child .bc-tip { left: 0; transform: none; } .bc-col:last-child .bc-tip { left: auto; right: 0; transform: none; }
.bc-lbl { display: flex; gap: 4px; margin: var(--sp-1) 0 0 30px; color: var(--text-muted); font-size: 10px; }
.bc-lbl span { flex: 1; text-align: center; white-space: nowrap; overflow: hidden; }
.bc-lbl span.on { color: var(--text); font-weight: var(--fw-medium); }
@keyframes bc-grow { from { transform: scaleY(0); } }
@media (prefers-reduced-motion: reduce) { .bc-bar { animation: none; } }
:root[data-rm] .bc-bar { animation: none; }
</style>
