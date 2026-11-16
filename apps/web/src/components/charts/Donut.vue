<script setup lang="ts">
/** Donut with a centre label and legend. Segment colours are design tokens. */
import { computed } from 'vue'

export interface Segment { label: string; value: number; color: string }
const props = defineProps<{ segments: Segment[]; center: string; sub?: string; size?: number }>()
const R = 42
const C = 2 * Math.PI * R
const total = computed(() => props.segments.reduce((a, s) => a + s.value, 0) || 1)
const arcs = computed(() => {
  let acc = 0
  return props.segments.map((s) => { const len = (s.value / total.value) * C; const a = { ...s, dash: `${len} ${C - len}`, off: -acc }; acc += len; return a })
})
</script>

<template>
  <div class="dn">
    <div class="dn-ring" :style="{ width: `${size ?? 120}px`, height: `${size ?? 120}px` }" role="img" :aria-label="`${center}${sub ? ' ' + sub : ''}`">
      <svg viewBox="0 0 100 100"><circle class="dn-bg" cx="50" cy="50" :r="R" /><circle v-for="a in arcs" :key="a.label" class="dn-seg" cx="50" cy="50" :r="R" :stroke="a.color" :stroke-dasharray="a.dash" :stroke-dashoffset="a.off" /></svg>
      <div class="dn-c"><b>{{ center }}</b><small v-if="sub">{{ sub }}</small></div>
    </div>
    <ul class="dn-l"><li v-for="s in segments" :key="s.label"><i :style="{ background: s.color }"></i>{{ s.label }}<b>{{ s.value }}</b></li></ul>
  </div>
</template>

<style scoped>
.dn { display: flex; align-items: center; gap: var(--sp-4); flex-wrap: wrap; }
.dn-ring { position: relative; flex: none; }
.dn-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.dn-bg { fill: none; stroke: color-mix(in srgb, var(--text) 10%, transparent); stroke-width: 12; }
.dn-seg { fill: none; stroke-width: 12; transition: stroke-dasharray var(--dur-slow) var(--ease); }
.dn-c { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; }
.dn-c b { font-size: 24px; font-weight: var(--fw-light); line-height: 1; font-variant-numeric: tabular-nums; }
.dn-c small { color: var(--text-muted); font-size: var(--fs-xs); }
.dn-l { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; flex: 1; min-width: 120px; }
.dn-l li { display: flex; align-items: center; gap: var(--sp-2); }
.dn-l i { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.dn-l b { margin-left: auto; font-weight: var(--fw-medium); font-variant-numeric: tabular-nums; }
</style>
