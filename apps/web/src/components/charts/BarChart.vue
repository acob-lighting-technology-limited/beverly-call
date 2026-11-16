<script setup lang="ts">
/** Vertical bars with labels. Used by: admin call volume and forecast. */
import { computed } from 'vue'

export interface Bar { label: string; value: number }
const props = withDefaults(defineProps<{ items: Bar[]; height?: number; highlight?: number; label?: string }>(), { height: 130, label: 'Bar chart' })
const max = computed(() => Math.max(...props.items.map((b) => b.value), 1))
const peak = computed(() => props.highlight ?? props.items.reduce((m, b, i, a) => (b.value > (a[m]?.value ?? 0) ? i : m), 0))
</script>

<template>
  <div class="bc" role="img" :aria-label="label">
    <div class="bc-bars" :style="{ height: `${height}px` }">
      <i v-for="(b, i) in items" :key="i" :class="{ pk: i === peak }" :style="{ height: `${Math.max(3, (b.value / max) * 100)}%` }" :title="`${b.label}: ${b.value}`"></i>
    </div>
    <div class="bc-lbl"><span v-for="(b, i) in items" :key="i">{{ items.length > 14 && i % 3 ? '' : b.label }}</span></div>
  </div>
</template>

<style scoped>
.bc-bars { display: flex; align-items: flex-end; gap: 4px; }
.bc-bars i { flex: 1; min-width: 3px; border-radius: 6px 6px 2px 2px; background: color-mix(in srgb, var(--accent) 55%, transparent); transition: height var(--dur-slow) var(--ease); }
.bc-bars i.pk { background: var(--accent); }
.bc-lbl { display: flex; gap: 4px; margin-top: var(--sp-1); color: var(--text-muted); font-size: 10px; }
.bc-lbl span { flex: 1; text-align: center; white-space: nowrap; overflow: hidden; }
</style>
