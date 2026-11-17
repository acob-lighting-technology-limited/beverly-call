<script setup lang="ts">
/** Friendly empty state: icon, headline, one line of guidance, and an optional action in the default slot. */
import Icon from '@/components/Icon.vue'

withDefaults(defineProps<{ icon?: string; title: string; hint?: string; compact?: boolean }>(), { icon: 'note', hint: '', compact: false })
</script>

<template>
  <div class="es" :class="{ compact }">
    <span class="es-ic"><Icon :name="icon" /></span>
    <b>{{ title }}</b>
    <p v-if="hint">{{ hint }}</p>
    <div v-if="$slots.default" class="es-act"><slot /></div>
  </div>
</template>

<style scoped>
.es { display: grid; justify-items: center; gap: 6px; padding: var(--sp-6) var(--sp-4); text-align: center; color: var(--text-muted); }
.es.compact { padding: var(--sp-4); }
.es-ic { display: grid; place-items: center; width: 52px; height: 52px; margin-bottom: 4px; border-radius: 50%; color: var(--text); background: radial-gradient(circle at 30% 25%, color-mix(in srgb, var(--accent) 42%, transparent), color-mix(in srgb, var(--accent) 14%, transparent)); box-shadow: 0 0 0 8px color-mix(in srgb, var(--accent) 8%, transparent); }
.es-ic :deep(.i) { width: 24px; height: 24px; }
.es b { color: var(--text); font-weight: var(--fw-regular); font-size: var(--fs-lg); }
.es p { margin: 0; max-width: 32ch; font-size: var(--fs-md); }
.es-act { margin-top: var(--sp-2); }
</style>
