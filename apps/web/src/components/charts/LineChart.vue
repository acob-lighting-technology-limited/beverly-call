<script setup lang="ts">
/** Smooth gradient area chart with hover/touch crosshair, tooltip, optional comparison series and animated entry.
 *  Pure SVG + HTML overlay, no dependency. Used by: admin overview and analytics. */
import { computed, ref, useId } from 'vue'
import { areaPath, niceMax, nearestIndex, smoothPath, toPoints } from '@/lib/chart-math'

export interface Point { label: string; value: number }
const props = withDefaults(defineProps<{
  series: Point[]
  /** Previous period or target, drawn as a dashed line under the main one. */
  compare?: Point[]
  compareLabel?: string
  height?: number
  format?: (n: number) => string
  label?: string
  seriesLabel?: string
}>(), { height: 150, compareLabel: 'Previous', label: 'Trend', seriesLabel: 'Now', format: (n: number) => String(n) })

const uid = useId()
const max = computed(() => niceMax(Math.max(...props.series.map((p) => p.value), ...(props.compare ?? []).map((p) => p.value), 1)))
const pts = computed(() => toPoints(props.series.map((p) => p.value), max.value))
const cpts = computed(() => (props.compare?.length ? toPoints(props.compare.map((p) => p.value), max.value) : []))
const line = computed(() => smoothPath(pts.value))
const cline = computed(() => smoothPath(cpts.value))
const area = computed(() => areaPath(pts.value))
const ticks = computed(() => {
  const s = props.series
  if (s.length < 3) return s.map((p) => p.label)
  return [s[0]!.label, s[Math.floor(s.length / 3)]!.label, s[Math.floor((2 * s.length) / 3)]!.label, s[s.length - 1]!.label]
})

const active = ref<number | null>(null)
const plot = ref<HTMLElement | null>(null)
function move(e: PointerEvent): void {
  const r = plot.value?.getBoundingClientRect()
  if (!r || !r.width) return
  active.value = nearestIndex((e.clientX - r.left) / r.width, props.series.length)
}
const tip = computed(() => {
  const i = active.value
  if (i === null || !props.series[i]) return null
  const p = pts.value[i]!
  const cur = props.series[i]!
  const prev = props.compare?.[i]
  return { x: p.x, y: p.y, label: cur.label, value: props.format(cur.value), prev: prev ? props.format(prev.value) : null }
})
const summary = computed(() => `${props.label}: latest ${props.format(props.series[props.series.length - 1]?.value ?? 0)}, peak ${props.format(Math.max(...props.series.map((p) => p.value), 0))}`)
</script>

<template>
  <figure class="lc" role="img" :aria-label="summary">
    <div class="lc-wrap" :style="{ height: `${height}px` }">
      <span class="lc-y lc-ymax">{{ format(max) }}</span>
      <span class="lc-y lc-ymid">{{ format(max / 2) }}</span>
      <div ref="plot" class="lc-plot" @pointermove="move" @pointerdown="move" @pointerleave="active = null">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient :id="`g${uid}`" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.55" />
              <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
            </linearGradient>
          </defs>
          <line v-for="g in [25, 50, 75]" :key="g" class="lc-grid" x1="0" x2="100" :y1="g" :y2="g" />
          <path v-if="area" class="lc-area" :d="area" :fill="`url(#g${uid})`" />
          <path v-if="cline" class="lc-cmp" :d="cline" fill="none" />
          <path v-if="line" class="lc-line" :d="line" pathLength="1" fill="none" />
        </svg>
        <i v-if="tip" class="lc-cursor" :style="{ left: `${tip.x}%` }"></i>
        <i v-if="tip" class="lc-dot" :style="{ left: `${tip.x}%`, top: `${tip.y}%` }"></i>
        <i v-else-if="pts.length" class="lc-now" :style="{ left: `${pts[pts.length - 1]!.x}%`, top: `${pts[pts.length - 1]!.y}%` }"></i>
        <div v-if="tip" class="lc-tip" :style="{ left: `${Math.min(88, Math.max(12, tip.x))}%` }">
          <small>{{ tip.label }}</small>
          <b>{{ tip.value }}</b>
          <small v-if="tip.prev !== null" class="lc-prev">{{ compareLabel }} {{ tip.prev }}</small>
        </div>
      </div>
    </div>
    <figcaption class="lc-ticks"><span v-for="(t, i) in ticks" :key="i">{{ t }}</span></figcaption>
    <div v-if="compare?.length" class="lc-legend"><span><i class="lg-a"></i>{{ seriesLabel }}</span><span><i class="lg-b"></i>{{ compareLabel }}</span></div>
  </figure>
</template>

<style scoped>
.lc { margin: 0; }
.lc-wrap { position: relative; padding-left: 34px; }
.lc-plot { position: relative; height: 100%; touch-action: pan-y; cursor: crosshair; }
.lc-plot svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.lc-y { position: absolute; left: 0; font-size: 10px; color: var(--text-muted); font-variant-numeric: tabular-nums; transform: translateY(-50%); }
.lc-ymax { top: 6%; } .lc-ymid { top: 50%; }
.lc-grid { stroke: var(--border); stroke-width: 1; stroke-dasharray: 2 5; vector-effect: non-scaling-stroke; }
.lc-area { opacity: 0; animation: lc-fade 0.7s 0.25s ease-out forwards; }
.lc-line { stroke: var(--accent); stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; stroke-dasharray: 1; stroke-dashoffset: 1; animation: lc-draw 0.9s ease-out forwards; filter: drop-shadow(0 3px 6px color-mix(in srgb, var(--accent) 45%, transparent)); }
.lc-cmp { stroke: var(--text-muted); stroke-width: 1.6; stroke-dasharray: 4 4; opacity: 0.7; vector-effect: non-scaling-stroke; }
.lc-cursor { position: absolute; top: 0; bottom: 0; width: 1px; background: color-mix(in srgb, var(--text) 25%, transparent); pointer-events: none; }
.lc-dot, .lc-now { position: absolute; width: 11px; height: 11px; margin: -5.5px 0 0 -5.5px; border-radius: 50%; background: var(--accent); border: 2px solid var(--surface); box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 28%, transparent); pointer-events: none; }
.lc-now { animation: lc-pulse 2s ease-in-out infinite; }
.lc-tip { position: absolute; top: -4px; transform: translate(-50%, -100%); display: grid; gap: 1px; padding: 6px 10px; border-radius: var(--r-md); background: var(--surface-inverse); color: var(--text-inverse); box-shadow: var(--sh-3); pointer-events: none; white-space: nowrap; z-index: 2; }
.lc-tip b { font-size: 16px; font-weight: var(--fw-medium); }
.lc-tip small { font-size: 10px; opacity: 0.75; }
.lc-ticks { display: flex; justify-content: space-between; margin: var(--sp-1) 0 0 34px; color: var(--text-muted); font-size: var(--fs-xs); }
.lc-legend { display: flex; gap: var(--sp-4); margin: var(--sp-2) 0 0 34px; color: var(--text-muted); font-size: var(--fs-xs); }
.lc-legend i { display: inline-block; width: 14px; height: 0; margin-right: 6px; vertical-align: middle; border-top: 3px solid var(--accent); border-radius: 2px; }
.lc-legend i.lg-b { border-top: 2px dashed var(--text-muted); }
@keyframes lc-draw { to { stroke-dashoffset: 0; } }
@keyframes lc-fade { to { opacity: 1; } }
@keyframes lc-pulse { 50% { box-shadow: 0 0 0 8px color-mix(in srgb, var(--accent) 6%, transparent); } }
@media (prefers-reduced-motion: reduce) { .lc-line { animation: none; stroke-dashoffset: 0; } .lc-area { animation: none; opacity: 1; } .lc-now { animation: none; } }
:root[data-rm] .lc-line { animation: none; stroke-dashoffset: 0; } :root[data-rm] .lc-area { animation: none; opacity: 1; }
</style>
