<script setup lang="ts">
/** Admin console. Opening it morphs out of the rail button, and the rail itself turns into the admin tabs
 *  (see AppNav). This view is the workspace: a Back button in the header plus the active section.
 *  The section is the route (/admin/:section); sections live in views/admin/. Used by: router. */
import { computed, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '@/components/PageHeader.vue'
import { adminSection } from '@/lib/admin-sections'
import { morphWithin, navMemory } from '@/lib/morph'
import { DEFAULT_SCREEN } from '@/lib/roles'
import { useSession } from '@/stores/session'

const VIEWS = {
  overview: defineAsyncComponent(() => import('./admin/AdminOverview.vue')),
  analytics: defineAsyncComponent(() => import('./admin/AdminAnalytics.vue')),
  agents: defineAsyncComponent(() => import('./admin/AdminAgents.vue')),
  shifts: defineAsyncComponent(() => import('./admin/AdminShifts.vue')),
  quality: defineAsyncComponent(() => import('./admin/AdminQuality.vue')),
  people: defineAsyncComponent(() => import('./admin/AdminPeople.vue')),
  settings: defineAsyncComponent(() => import('./admin/AdminSettings.vue')),
  system: defineAsyncComponent(() => import('./admin/AdminSystem.vue')),
} as const

const route = useRoute()
const router = useRouter()
const session = useSession()
const current = computed(() => adminSection(route.params.section))
const view = computed(() => VIEWS[current.value.id as keyof typeof VIEWS])
const goBack = (): void => { void router.push(navMemory.lastNormal || `/${DEFAULT_SCREEN[session.role ?? 'agent']}`) }

// Grow out of the rail button the user just pressed (none for keyboard or a direct link).
const origin = morphWithin(document.querySelector('.views')?.getBoundingClientRect())
const morphStyle = origin ? { '--mx': `${origin.x}px`, '--my': `${origin.y}px` } : undefined
</script>

<template>
  <section :class="{ 'adm-morph': !!origin }" :style="morphStyle">
    <PageHeader :title="current.label">
      <template #leading><button class="ib" aria-label="Back to normal view" title="Back to normal view" @click="goBack"><Icon name="lft" /></button></template>
    </PageHeader>
    <Transition name="adm-sec" mode="out-in">
      <component :is="view" :key="current.id" class="adm-body" />
    </Transition>
  </section>
</template>

<style scoped>
.adm-body { min-width: 0; }
/* the console grows out of the rail button that opened it */
.view.adm-morph { animation: adm-morph 0.6s cubic-bezier(0.32, 0.72, 0, 1) both; }
@keyframes adm-morph {
  from { clip-path: circle(0px at var(--mx) var(--my)); opacity: 0.4; }
  to { clip-path: circle(150% at var(--mx) var(--my)); opacity: 1; }
}
.adm-sec-enter-active, .adm-sec-leave-active { transition: opacity var(--dur-base) ease, transform var(--dur-base) var(--ease); }
.adm-sec-enter-from { opacity: 0; transform: translateY(8px); }
.adm-sec-leave-to { opacity: 0; transform: translateY(-4px); }
@media (prefers-reduced-motion: reduce) { .view.adm-morph { animation: none; } .adm-sec-enter-active, .adm-sec-leave-active { transition: none; } }
:root[data-rm] .view.adm-morph { animation: none; }
</style>
