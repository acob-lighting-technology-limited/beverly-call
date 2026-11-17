<script setup lang="ts">
/** Loading and error state for a resource. Loading shows a shimmering skeleton (it keeps the layout from jumping);
 *  an error shows a clear alert. Renders nothing when neither applies. Used by: every screen that loads data. */
import Icon from '@/components/Icon.vue'

defineProps<{ loading: boolean; error: string; what: string }>()
</script>

<template>
  <div v-if="loading" class="sk" role="status" aria-busy="true">
    <span class="sr">Loading {{ what }}…</span>
    <i style="width: 38%"></i><i style="width: 100%"></i><i style="width: 84%"></i><i style="width: 62%"></i>
  </div>
  <div v-else-if="error" class="ban sk-err" role="alert"><Icon name="alert" /><span>{{ error }}</span></div>
</template>

<style scoped>
.sk { display: grid; gap: 10px; padding: var(--sp-3) 2px; grid-column: 1 / -1; }
.sk i { display: block; height: 14px; border-radius: var(--r-pill); background: linear-gradient(90deg, color-mix(in srgb, var(--text) 8%, transparent) 25%, color-mix(in srgb, var(--text) 18%, transparent) 50%, color-mix(in srgb, var(--text) 8%, transparent) 75%); background-size: 200% 100%; animation: sk-shimmer 1.3s ease-in-out infinite; }
.sk i:first-of-type { height: 18px; }
.sk-err { display: flex; align-items: center; gap: var(--sp-2); background: var(--danger-bg); color: var(--danger-fg); grid-column: 1 / -1; }
.sk-err .i { flex: none; width: 18px; height: 18px; }
@keyframes sk-shimmer { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .sk i { animation: none; } }
:root[data-rm] .sk i { animation: none; }
</style>
