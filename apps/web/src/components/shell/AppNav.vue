<script setup lang="ts">
/** Main navigation: rail on desktop, bottom bar on mobile, plus the section sub-navigation.
 *  Inside the admin console the same rail morphs into the admin tabs, with a Back item to the normal view.
 *  Depends on: session (reachable screens), settings (language), roles (GROUPS), admin-sections.
 *  Used by: App.vue. */
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import Icon from '@/components/Icon.vue'
import { useBrandMark } from '@/lib/use-brand-mark'
import { markMorph, navMemory } from '@/lib/morph'
import { ADMIN_SECTIONS, adminSection } from '@/lib/admin-sections'
import { useSession } from '@/stores/session'
import { useSettings } from '@/stores/settings'
import { DEFAULT_SCREEN, GROUPS } from '@/lib/roles'
import { groupLabel, screenTitle } from '@/lib/i18n'
import type { ScreenId } from '@/types'

const route = useRoute()
const session = useSession()
const settings = useSettings()

const current = computed(() => route.meta.screen as ScreenId | undefined)
const isAdmin = computed(() => current.value === 'admin')
const section = computed(() => adminSection(route.params.section).id)
const groupIdx = computed(() => GROUPS.findIndex((g) => current.value && g.screens.includes(current.value)))
const groups = computed(() => GROUPS.map((g, i) => ({ ...g, i, reachable: g.screens.filter((s) => session.screens.includes(s)) })).filter((g) => g.reachable.length))
const subnav = computed(() => (!isAdmin.value && groupIdx.value > 0 ? GROUPS[groupIdx.value]!.screens.filter((s) => session.screens.includes(s)) : []))
/** Agents have only their own cases under Monitor, so the tab says so. */
const navLabel = (i: number): string => (session.role === 'agent' && GROUPS[i]?.label === 'Monitor' ? 'Cases' : groupLabel(settings.p.lang, i))
const mark = useBrandMark(true)
/** Where Back goes: the last normal screen, or the role's landing screen. */
const backTo = computed(() => { void route.fullPath; return navMemory.lastNormal || `/${DEFAULT_SCREEN[session.role ?? 'agent']}` })
</script>

<template>
  <nav :aria-label="isAdmin ? 'Admin sections' : 'Main'" :data-admin="isAdmin ? '' : undefined">
    <img class="bmark rail-logo" :src="mark" alt="Beverly" />
    <Transition name="rail-morph" mode="out-in">
      <div v-if="!isAdmin" key="main" class="rail-items">
        <RouterLink v-for="(g, n) in groups" :key="g.label" class="rail-item" :style="{ '--i': n }" :to="`/${g.reachable[0]}`" :class="{ on: g.i === groupIdx }" :title="navLabel(g.i)" :aria-label="navLabel(g.i)" :aria-current="g.i === groupIdx ? 'page' : undefined" @pointerdown="markMorph">
          <Icon :name="g.icon" /><span>{{ navLabel(g.i) }}</span>
        </RouterLink>
      </div>
      <div v-else key="admin" class="rail-items">
        <RouterLink class="rail-item rail-back" :style="{ '--i': 0 }" :to="backTo" title="Back to normal view" aria-label="Back to normal view">
          <Icon name="lft" /><span>Back</span>
        </RouterLink>
        <RouterLink v-for="(s, n) in ADMIN_SECTIONS" :key="s.id" class="rail-item" :style="{ '--i': n + 1 }" :to="`/admin/${s.id}`" :class="{ on: s.id === section }" :title="s.label" :aria-label="s.label" :aria-current="s.id === section ? 'page' : undefined">
          <Icon :name="s.icon" /><span>{{ s.short }}</span>
        </RouterLink>
      </div>
    </Transition>
  </nav>
  <div class="subnav" :class="{ on: subnav.length > 1 }" role="navigation" aria-label="Section">
    <RouterLink v-for="s in subnav" :key="s" :to="`/${s}`" :class="{ on: s === current }" :aria-current="s === current ? 'page' : undefined">{{ screenTitle(settings.p.lang, s) }}</RouterLink>
  </div>
</template>
