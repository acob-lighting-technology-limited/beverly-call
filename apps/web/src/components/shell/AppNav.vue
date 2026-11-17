<script setup lang="ts">
/** Main navigation: rail on desktop, bottom bar on mobile, plus the section sub-navigation.
 *  Inside the admin console the same rail morphs into the admin tabs; the way back is the Back button in the page header.
 *  Depends on: session (reachable screens), settings (language), roles (GROUPS), admin-sections.
 *  Used by: App.vue. */
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import Icon from '@/components/Icon.vue'
import { useBrandMark } from '@/lib/use-brand-mark'
import { markMorph } from '@/lib/morph'
import { ADMIN_GROUPS, adminGroupOf, adminSection } from '@/lib/admin-sections'
import { useSession } from '@/stores/session'
import { useSettings } from '@/stores/settings'
import { GROUPS } from '@/lib/roles'
import { groupLabel, screenTitle } from '@/lib/i18n'
import type { ScreenId } from '@/types'

const route = useRoute()
const session = useSession()
const settings = useSettings()

const current = computed(() => route.meta.screen as ScreenId | undefined)
const isAdmin = computed(() => current.value === 'admin')
const adminGroup = computed(() => adminGroupOf(adminSection(route.params.section).id).id)
const groupIdx = computed(() => GROUPS.findIndex((g) => current.value && g.screens.includes(current.value)))
const groups = computed(() => GROUPS.map((g, i) => ({ ...g, i, reachable: g.screens.filter((s) => session.screens.includes(s)) })).filter((g) => g.reachable.length))
const subnav = computed(() => (!isAdmin.value && groupIdx.value > 0 ? GROUPS[groupIdx.value]!.screens.filter((s) => session.screens.includes(s)) : []))
/** Agents have only their own cases under Monitor, so the tab says so. */
const navLabel = (i: number): string => (session.role === 'agent' && GROUPS[i]?.label === 'Monitor' ? 'Cases' : groupLabel(settings.p.lang, i))
const mark = useBrandMark(true)
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
        <RouterLink v-for="(g, n) in ADMIN_GROUPS" :key="g.id" class="rail-item" :style="{ '--i': n }" :to="`/admin/${g.sections[0]}`" :class="{ on: g.id === adminGroup }" :title="g.label" :aria-label="g.label" :aria-current="g.id === adminGroup ? 'page' : undefined">
          <Icon :name="g.icon" /><span>{{ g.short }}</span>
        </RouterLink>
      </div>
    </Transition>
  </nav>
  <div class="subnav" :class="{ on: subnav.length > 1 }" role="navigation" aria-label="Section">
    <RouterLink v-for="s in subnav" :key="s" :to="`/${s}`" :class="{ on: s === current }" :aria-current="s === current ? 'page' : undefined">{{ screenTitle(settings.p.lang, s) }}</RouterLink>
  </div>
</template>
