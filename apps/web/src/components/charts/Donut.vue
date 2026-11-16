<script setup lang="ts">
/** Donut with gradient rounded segments, hover to inspect a slice, animated sweep and a legend with shares. */
import { computed, ref, useId } from 'vue'

export interface Segment { label: string; value: number; color: string }
const props = defineProps<{ segments: Segment[]; center: string; sub?: string; size?: number }>()
const uid = useId()
const R = 40
const C = 2 * Math.PI * R
const GAP = 2.2
const total = computed(() => props.segments.reduce((a, s) => a + s.value, 0))
const arcs = computed(() => {
  let acc = 0
  const n = props.segments.filter((s) => s.value > 0).length
  return props.segments.map((s, i) => {
    const len = total.value ? (s.value / total.value) * C : 0
    const draw = Math.max(0, len - (n > 1 ? GAP : 0))
    const a = { ...s, i, dash: `${draw} ${C - draw}`, off: -acc, pct: total.value ? Math.round((s.value / total.value) * 100) : 0 }
    acc += len
    return a
  })
})
const active = ref<number | null>(null)
const shown = computed(() => (active.value === null ? { big: props.center, small: props.sub ?? '' } : { big: String(props.segments[active.value]?.value ?? ''), small: props.segments[active.value]?.label ?? '' }))
const px = computed(() => props.size ?? 128)
</script>

<template>
  <div class="dn">
    <div class="dn-ring" :style="{ width: `${px}px`, height: `${px}px` }" role="img" :aria-label="`${center}${sub ? ' ' + sub : ''}`" @pointerleave="active = null">
      <svg viewBox="0 0 100 100">
        <defs>
          <linearGradient v-for="a in arcs" :id="`dg${uid}${a.i}`" :key="a.i" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" :stop-color="a.color" />
            <stop offset="100%" :stop-color="`color-mix(in srgb, ${a.color} 62%, white)`" />
          </linearGradient>
        </defs>
        <circle class="dn-bg" cx="50" cy="50" :r="R" />
        <circle v-for="a in arcs.filter((x) => x.value > 0)" :key="a.i" class="dn-seg" :class="{ dim: active !== null && active !== a.i }" cx="50" cy="50" :r="R" :stroke="`url(#dg${uid}${a.i})`" :stroke-dasharray="a.dash" :stroke-dashoffset="a.off" @pointerenter="active = a.i" @pointerdown="active = a.i" />
      </svg>
      <div class="dn-c"><b>{{ shown.big }}</b><small v-if="shown.small">{{ shown.small }}</small></div>
    </div>
    <ul class="dn-l">
      <li v-for="a in arcs" :key="a.i" :class="{ on: active === a.i }" @pointerenter="active = a.i" @pointerleave="active = null">
        <i :style="{ background: a.color }"></i>{{ a.label }}<span class="dn-pct">{{ a.pct }}%</span><b>{{ a.value }}</b>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.dn { display: flex; align-items: center; gap: var(--sp-4); flex-wrap: wrap; }
.dn-ring { position: relative; flex: none; }
.dn-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); overflow: visible; }
.dn-bg { fill: none; stroke: color-mix(in srgb, var(--text) 9%, transparent); stroke-width: 11; }
.dn-seg { fill: none; stroke-width: 11; stroke-linecap: round; cursor: pointer; transition: opacity var(--dur-fast), stroke-width var(--dur-fast); animation: dn-sweep 0.9s cubic-bezier(0.32, 0.72, 0, 1) both; }
.dn-seg:hover { stroke-width: 13; } .dn-seg.dim { opacity: 0.35; }
.dn-c { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; pointer-events: none; }
.dn-c b { font-size: 26px; font-weight: var(--fw-light); line-height: 1; font-variant-numeric: tabular-nums; }
.dn-c small { color: var(--text-muted); font-size: var(--fs-xs); max-width: 74px; }
.dn-l { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; flex: 1; min-width: 150px; }
.dn-l li { display: flex; align-items: center; gap: var(--sp-2); padding: 4px 8px; border-radius: var(--r-pill); transition: background var(--dur-fast); }
.dn-l li.on { background: color-mix(in srgb, var(--text) 8%, transparent); }
.dn-l i { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.dn-pct { margin-left: auto; color: var(--text-muted); font-size: var(--fs-xs); font-variant-numeric: tabular-nums; }
.dn-l b { min-width: 28px; text-align: right; font-weight: var(--fw-medium); font-variant-numeric: tabular-nums; }
@keyframes dn-sweep { from { stroke-dasharray: 0 400; } }
@media (prefers-reduced-motion: reduce) { .dn-seg { animation: none; } }
:root[data-rm] .dn-seg { animation: none; }
</style>
