<script setup lang="ts">
/** Ranked horizontal bars (top issues, languages, leaderboard). */
import { computed } from 'vue'

export interface Row { label: string; value: number; sub?: string }
const props = defineProps<{ rows: Row[]; unit?: string }>()
const max = computed(() => Math.max(...props.rows.map((r) => r.value), 1))
</script>

<template>
  <ul class="bl">
    <li v-for="r in rows" :key="r.label">
      <div class="bl-h"><span>{{ r.label }}<small v-if="r.sub">{{ r.sub }}</small></span><b>{{ r.value }}{{ unit ?? '' }}</b></div>
      <div class="bl-t"><i :style="{ width: `${(r.value / max) * 100}%` }"></i></div>
    </li>
  </ul>
</template>

<style scoped>
.bl { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sp-3); }
.bl-h { display: flex; justify-content: space-between; gap: var(--sp-2); }
.bl-h small { display: block; color: var(--text-muted); font-size: var(--fs-xs); }
.bl-h b { font-weight: var(--fw-medium); font-variant-numeric: tabular-nums; }
.bl-t { height: 6px; margin-top: 4px; border-radius: var(--r-pill); background: color-mix(in srgb, var(--text) 10%, transparent); overflow: hidden; }
.bl-t i { display: block; height: 100%; border-radius: var(--r-pill); background: var(--accent); transition: width var(--dur-slow) var(--ease); }
</style>
