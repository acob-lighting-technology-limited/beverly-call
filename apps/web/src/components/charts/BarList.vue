<script setup lang="ts">
/** Ranked horizontal bars with gradient fill, share of total and animated entry (top issues, languages, leaderboard). */
import { computed } from 'vue'

export interface Row { label: string; value: number; sub?: string }
const props = defineProps<{ rows: Row[]; unit?: string; showShare?: boolean }>()
const max = computed(() => Math.max(...props.rows.map((r) => r.value), 1))
const total = computed(() => props.rows.reduce((a, r) => a + r.value, 0))
</script>

<template>
  <ol class="bl">
    <li v-for="(r, i) in rows" :key="r.label">
      <div class="bl-h">
        <span class="bl-rank">{{ i + 1 }}</span>
        <span class="bl-name">{{ r.label }}<small v-if="r.sub">{{ r.sub }}</small></span>
        <small v-if="showShare !== false && total" class="bl-share">{{ Math.round((r.value / total) * 100) }}%</small>
        <b>{{ r.value }}{{ unit ?? '' }}</b>
      </div>
      <div class="bl-t"><i :style="{ width: `${(r.value / max) * 100}%`, animationDelay: `${i * 60}ms` }"></i></div>
    </li>
  </ol>
</template>

<style scoped>
.bl { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sp-3); }
.bl-h { display: flex; align-items: center; gap: var(--sp-2); }
.bl-rank { flex: none; width: 20px; height: 20px; display: grid; place-items: center; border-radius: 50%; background: color-mix(in srgb, var(--accent) 28%, transparent); font-size: 10px; font-weight: var(--fw-medium); font-variant-numeric: tabular-nums; }
.bl-name { flex: 1; min-width: 0; }
.bl-name small { display: block; color: var(--text-muted); font-size: var(--fs-xs); }
.bl-share { color: var(--text-muted); font-variant-numeric: tabular-nums; }
.bl-h b { min-width: 28px; text-align: right; font-weight: var(--fw-medium); font-variant-numeric: tabular-nums; }
.bl-t { height: 8px; margin-top: 6px; border-radius: var(--r-pill); background: color-mix(in srgb, var(--text) 8%, transparent); overflow: hidden; }
.bl-t i { display: block; height: 100%; border-radius: var(--r-pill); background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 70%, transparent), var(--accent)); transform-origin: left; animation: bl-grow 0.7s cubic-bezier(0.32, 0.72, 0, 1) both; }
@keyframes bl-grow { from { transform: scaleX(0); } }
@media (prefers-reduced-motion: reduce) { .bl-t i { animation: none; } }
:root[data-rm] .bl-t i { animation: none; }
</style>
