<script setup lang="ts">
/** Busy-hours heatmap: 7 days by 24 hours. Cell opacity follows the call count. */
import { computed } from 'vue'

const props = defineProps<{ matrix: number[][] }>()
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const max = computed(() => Math.max(1, ...props.matrix.flat()))
</script>

<template>
  <div class="hm2" role="img" aria-label="Calls by weekday and hour">
    <template v-for="(row, d) in matrix" :key="d">
      <span class="hm2-d">{{ DAYS[d] }}</span>
      <i v-for="(n, h) in row" :key="h" :title="`${DAYS[d]} ${String(h).padStart(2, '0')}:00, ${n} calls`" :style="{ opacity: n ? 0.18 + (n / max) * 0.82 : 0.07 }"></i>
    </template>
    <span></span><span v-for="h in 24" :key="h" class="hm2-h">{{ (h - 1) % 6 === 0 ? String(h - 1).padStart(2, '0') : '' }}</span>
  </div>
</template>

<style scoped>
.hm2 { display: grid; grid-template-columns: 28px repeat(24, 1fr); gap: 2px; align-items: center; }
.hm2 i { aspect-ratio: 1; border-radius: 3px; background: var(--accent); }
.hm2-d, .hm2-h { color: var(--text-muted); font-size: 10px; }
.hm2-h { text-align: center; overflow: visible; white-space: nowrap; }
</style>
