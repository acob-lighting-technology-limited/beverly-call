<script setup lang="ts">
/** Admin console. Opening it morphs out of the nav button into a full workspace: live pipeline, call analytics,
 *  agents, quality, users and roles, settings, system and audit. The section is the route (/admin/:section).
 *  Sections live in views/admin/. Used by: router. */
import { computed, defineAsyncComponent } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '@/components/PageHeader.vue'
import { morphWithin } from '@/lib/morph'

interface Section { id: string; label: string; icon: string; hint: string }
const SECTIONS: Section[] = [
  { id: 'overview', label: 'Overview', icon: 'chart', hint: 'Live pipeline and today' },
  { id: 'analytics', label: 'Call analytics', icon: 'phone', hint: 'Volume, busy hours, forecast' },
  { id: 'agents', label: 'Agents', icon: 'users', hint: 'Team and performance' },
  { id: 'quality', label: 'Quality', icon: 'check', hint: 'SLA, cases, QA scores' },
  { id: 'people', label: 'Users and roles', icon: 'lock', hint: 'Who can use the desk' },
  { id: 'settings', label: 'Settings', icon: 'sliders', hint: 'Limits, outages, replies' },
  { id: 'system', label: 'System and audit', icon: 'db', hint: 'Connections, retention, log' },
]
const VIEWS = {
  overview: defineAsyncComponent(() => import('./admin/AdminOverview.vue')),
  analytics: defineAsyncComponent(() => import('./admin/AdminAnalytics.vue')),
  agents: defineAsyncComponent(() => import('./admin/AdminAgents.vue')),
  quality: defineAsyncComponent(() => import('./admin/AdminQuality.vue')),
  people: defineAsyncComponent(() => import('./admin/AdminPeople.vue')),
  settings: defineAsyncComponent(() => import('./admin/AdminSettings.vue')),
  system: defineAsyncComponent(() => import('./admin/AdminSystem.vue')),
} as const

const route = useRoute()
const current = computed(() => SECTIONS.find((s) => s.id === route.params.section) ?? SECTIONS[0]!)
const view = computed(() => VIEWS[current.value.id as keyof typeof VIEWS])

// Grow out of the nav button the user just pressed (none for keyboard or a direct link).
const origin = morphWithin(document.querySelector('.views')?.getBoundingClientRect())
const morphStyle = origin ? { '--mx': `${origin.x}px`, '--my': `${origin.y}px` } : undefined
</script>

<template>
  <section :class="{ 'adm-morph': !!origin }" :style="morphStyle">
    <PageHeader :title="current.label" />
    <div class="adm">
      <nav class="c adm-nav hs" aria-label="Admin sections">
        <RouterLink v-for="s in SECTIONS" :key="s.id" :to="`/admin/${s.id}`" class="adm-link" :class="{ on: s.id === current.id }" :aria-current="s.id === current.id ? 'page' : undefined">
          <Icon :name="s.icon" /><span class="adm-txt">{{ s.label }}<small>{{ s.hint }}</small></span>
        </RouterLink>
      </nav>
      <Transition name="adm-sec" mode="out-in">
        <component :is="view" :key="current.id" class="adm-body" />
      </Transition>
    </div>
  </section>
</template>

<style scoped>
.adm { display: grid; gap: var(--sp-3); align-items: start; }
.adm-body { min-width: 0; }
.adm-nav { display: flex; gap: var(--sp-1); padding: var(--sp-1); overflow-x: auto; border-radius: var(--r-pill); }
.adm-link { display: inline-flex; align-items: center; gap: var(--sp-2); flex: none; padding: 8px 14px; border-radius: var(--r-pill); color: var(--text); text-decoration: none; white-space: nowrap; transition: background var(--dur-fast); }
.adm-link:hover { background: color-mix(in srgb, var(--text) 8%, transparent); }
.adm-link.on { background: var(--surface-inverse); color: var(--text-inverse); }
.adm-txt { display: grid; line-height: 1.15; }
.adm-txt small { display: none; font-size: var(--fs-xs); opacity: .7; }
@media (min-width: 900px) {
  .adm { grid-template-columns: 236px minmax(0, 1fr); }
  .adm-nav { position: sticky; top: calc(var(--sh, 90px) + 4px); flex-direction: column; overflow: visible; border-radius: var(--r-xl); padding: var(--sp-2); gap: 2px; }
  .adm-link { border-radius: var(--r-lg); padding: 10px 12px; }
  .adm-txt small { display: block; }
}
/* the console grows out of the nav button that opened it */
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
