<script setup lang="ts">
/** Compact stat tile: icon, label, big value, change badge and a sparkline. Two across on phones, four across on desktop
 *  (the grid is the parent's `.stat-grid`). Used by: admin overview, analytics, quality. */
import Icon from '@/components/Icon.vue'
import Sparkline from '@/components/charts/Sparkline.vue'

withDefaults(defineProps<{
  icon: string
  label: string
  value: string | number
  /** Percent change versus the previous period. Positive is good unless `invert` (for example abandon rate). */
  delta?: number | null
  invert?: boolean
  spark?: number[]
  sub?: string
}>(), { delta: null, invert: false, spark: () => [] })
</script>

<template>
  <div class="st">
    <div class="st-h"><span class="st-ic"><Icon :name="icon" /></span><small>{{ label }}</small></div>
    <div class="st-v"><b>{{ value }}</b>
      <span v-if="delta !== null" class="pill" :class="(delta >= 0) !== invert ? 'ok' : 'bad'">{{ delta >= 0 ? '+' : '' }}{{ delta }}%</span></div>
    <small v-if="sub" class="st-sub">{{ sub }}</small>
    <Sparkline v-if="spark.length > 1" :values="spark" :tone="delta === null ? 'accent' : (delta >= 0) !== invert ? 'good' : 'bad'" />
  </div>
</template>

<style scoped>
.st { display: grid; gap: 4px; align-content: start; min-width: 0; }
.st-h { display: flex; align-items: center; gap: var(--sp-2); min-width: 0; }
.st-h small { color: var(--text-muted); font-size: var(--fs-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-ic { flex: none; display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: color-mix(in srgb, var(--accent) 30%, transparent); }
.st-ic :deep(.i) { width: 15px; height: 15px; }
.st-v { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--sp-2); }
.st-v b { font-size: clamp(26px, 7vw, 34px); font-weight: var(--fw-light); line-height: 1.05; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
.st-sub { color: var(--text-muted); font-size: var(--fs-xs); }
</style>
