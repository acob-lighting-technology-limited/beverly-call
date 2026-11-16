<script setup lang="ts">
/** Area line chart for a short series. Pure SVG, no dependency. Used by: admin dashboard and analytics. */
import { computed } from 'vue'

export interface Point { label: string; value: number }
const props = withDefaults(defineProps<{ series: Point[]; height?: number; format?: (n: number) => string; label?: string }>(), { height: 120, format: (n: number) => String(n), label: 'Trend' })

const W = 300
const pad = 6
const max = computed(() => Math.max(...props.series.map((p) => p.value), 1))
const pts = computed(() => props.series.map((p, i) => ({
  x: props.series.length < 2 ? W / 2 : (i * (W - 2 * pad)) / (props.series.length - 1) + pad,
  y: props.height - pad - (p.value / max.value) * (props.height - 2 * pad - 10),
})))
const line = computed(() => pts.value.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '))
const area = computed(() => (pts.value.length ? `${pad},${props.height} ${line.value} ${W - pad},${props.height}` : ''))
const last = computed(() => pts.value[pts.value.length - 1])
const ticks = computed(() => {
  const s = props.series
  if (s.length < 3) return s.map((p) => p.label)
  return [s[0]!.label, s[Math.floor(s.length / 2)]!.label, s[s.length - 1]!.label]
})
</script>

<template>
  <figure class="lc" role="img" :aria-label="`${label}: latest ${format(series[series.length - 1]?.value ?? 0)}, high ${format(max)}`">
    <svg :viewBox="`0 0 ${W} ${height}`" preserveAspectRatio="none" :style="{ height: `${height}px` }">
      <line v-for="g in 3" :key="g" class="lc-grid" x1="0" :x2="W" :y1="(height / 4) * g" :y2="(height / 4) * g" />
      <polygon v-if="area" class="lc-area" :points="area" />
      <polyline v-if="line" class="lc-line" :points="line" fill="none" />
      <circle v-if="last" class="lc-dot" :cx="last.x" :cy="last.y" r="3.5" />
    </svg>
    <figcaption class="lc-ticks"><span v-for="(t, i) in ticks" :key="i">{{ t }}</span></figcaption>
  </figure>
</template>

<style scoped>
.lc { margin: 0; }
.lc svg { display: block; width: 100%; overflow: visible; }
.lc-grid { stroke: var(--border); stroke-width: 1; stroke-dasharray: 2 4; vector-effect: non-scaling-stroke; }
.lc-area { fill: color-mix(in srgb, var(--accent) 30%, transparent); }
.lc-line { stroke: var(--accent); stroke-width: 2.5; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.lc-dot { fill: var(--accent); stroke: var(--surface); stroke-width: 2; vector-effect: non-scaling-stroke; }
.lc-ticks { display: flex; justify-content: space-between; margin-top: var(--sp-1); color: var(--text-muted); font-size: var(--fs-xs); }
</style>
