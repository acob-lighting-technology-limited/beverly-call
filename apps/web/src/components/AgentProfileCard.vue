<script setup lang="ts">
/** An agent's profile and analytics: who they are, how they are doing today, this week and this month. Data: /agents/:id/profile. Used by: the Profile panel and admin Agents. */
import { computed, ref, watch } from 'vue'
import { LANGUAGE_NAMES, type AgentProfile } from '@beverly-call/shared'
import Icon from '@/components/Icon.vue'
import StateBanner from '@/components/StateBanner.vue'
import BarChart from '@/components/charts/BarChart.vue'
import BarList from '@/components/charts/BarList.vue'
import { api } from '@/lib/api'
import { clock } from '@/lib/format'

import { photoSrc } from '@/lib/photo'
const props = defineProps<{ agentId: string; photo?: string }>()
const data = ref<AgentProfile | null>(null)
const error = ref('')
const loading = ref(true)
const period = ref<'today' | 'week' | 'month'>('today')

async function load(): Promise<void> {
  loading.value = true; error.value = ''
  try { data.value = await api<AgentProfile>(`/agents/${encodeURIComponent(props.agentId)}/profile`) }
  catch (e) { error.value = e instanceof Error ? e.message : 'Could not load the profile'; data.value = null }
  finally { loading.value = false }
}
watch(() => props.agentId, load, { immediate: true })

/** The photo passed in (the signed-in person's), or the one Beverly holds for this agent. */
const shown = computed(() => props.photo || (data.value ? photoSrc(data.value.id, data.value.photoVersion) : ''))
const s = computed(() => data.value?.[period.value])
const initials = computed(() => (data.value?.name ?? '').split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase())
const PERIODS = [['today', 'Today'], ['week', '7 days'], ['month', '30 days']] as const
const hourBars = computed(() => (data.value?.hours ?? []).map((v, i) => ({ label: String(i).padStart(2, '0'), value: v })))
const dayBars = computed(() => (data.value?.days ?? []).map((d) => ({ label: d.label.slice(0, 2), value: d.calls })))
const outcomes = computed(() => (data.value?.outcomes ?? []).map((o) => ({ label: o.label, value: o.count, sub: '' })))
const handle = (sec: number): string => (sec ? clock(sec) : '—')
defineExpose({ reload: load })
</script>

<template>
  <StateBanner :loading="loading && !data" :error="error" what="the agent profile" />
  <div v-if="data" class="ap">
    <div class="ap-head">
      <div class="ap-av" :style="shown ? { backgroundImage: `url(${shown})` } : {}">{{ shown ? '' : initials }}<i :class="{ on: data.online }" :title="data.online ? 'Online' : 'Offline'"></i></div>
      <div class="ap-who"><b>{{ data.name }}</b><span class="ap-sub">{{ data.role }} · {{ data.staffId }}</span>
        <span class="ap-lang" v-if="data.languages.length">{{ data.languages.map((l) => LANGUAGE_NAMES[l] ?? l).join(' · ') }}</span></div>
      <div class="ap-act"><slot name="actions" /></div>
    </div>
    <slot name="shift" />

    <div class="ap-per" role="group" aria-label="Period"><button v-for="p in PERIODS" :key="p[0]" :class="{ on: period === p[0] }" @click="period = p[0]">{{ p[1] }}</button></div>

    <div v-if="s" class="ap-kpis">
      <div><Icon name="phone" /><b>{{ s.calls }}</b><small>Calls</small></div>
      <div><Icon name="clock" /><b>{{ handle(s.avgHandleSeconds) }}</b><small>Handle time</small></div>
      <div><Icon name="check" /><b>{{ s.rating === null ? '—' : s.rating }}</b><small>Rating{{ s.ratingCount ? ` (${s.ratingCount})` : '' }}</small></div>
      <div><Icon name="flag" /><b>{{ s.firstCallResolvedPct }}%</b><small>Solved first call</small></div>
      <div><Icon name="note" /><b>{{ s.casesOpened }}<em> / {{ s.casesResolved }}</em></b><small>Cases opened / fixed</small></div>
      <div><Icon name="clock" /><b>{{ s.callbacksDone }}</b><small>Callbacks done</small></div>
    </div>

    <div class="ap-card"><div class="hd"><Icon name="chart" /><b>Calls, last 14 days</b></div><BarChart :items="dayBars" :height="90" label="Calls per day" /></div>
    <div class="ap-card"><div class="hd"><Icon name="clock" /><b>Calls by hour, today</b></div><BarChart :items="hourBars" :height="70" label="Calls per hour today" /></div>
    <div v-if="outcomes.length" class="ap-card"><div class="hd"><Icon name="flag" /><b>Outcomes, 30 days</b></div><BarList :rows="outcomes" /></div>

    <div class="ap-card ap-facts">
      <div><small>Open cases</small><b>{{ data.openCases }}</b></div>
      <div><small>Open callbacks</small><b>{{ data.openCallbacks }}</b></div>
      <div><small>Quality score</small><b>{{ data.qa.average === null ? 'Not scored yet' : `${data.qa.average} of 100 (${data.qa.scored} calls)` }}</b></div>
    </div>
  </div>
</template>

<style scoped>
.ap { display: grid; gap: 10px; }
.ap-head { display: flex; align-items: center; gap: 12px; padding: 4px 0; }
.ap-who { flex: 1; min-width: 0; display: grid; gap: 1px; }
.ap-who b { font-weight: 500; font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ap-sub { color: var(--mut); font-size: 12px; }
.ap-lang { color: var(--mut); font-size: 11px; }
.ap-act { flex: none; }
.ap-act :deep(.btns) { margin: 0; gap: 6px; justify-content: flex-end; }
.ap-act :deep(.fbtn), .ap-act :deep(button) { min-width: 0; height: auto; padding: 6px 12px; font-size: 12px; }
.ap-av { position: relative; flex: none; width: 56px; height: 56px; border-radius: 50%; display: grid; place-items: center; font-size: 19px; color: var(--on-accent); background: linear-gradient(135deg, var(--yel), color-mix(in srgb, var(--yel) 55%, #fff)) center/cover; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12); }
.ap-av i { position: absolute; right: 0; bottom: 0; width: 13px; height: 13px; border-radius: 50%; border: 2px solid var(--card); background: #9a9aa3; }
.ap-av i.on { background: #3fae6a; }
.ap-per { display: grid; grid-template-columns: repeat(3, 1fr); padding: 3px; border-radius: 999px; background: color-mix(in srgb, var(--ink) 7%, transparent); }
.ap-per button { height: 30px; min-width: 0; padding: 0; border-radius: 999px; background: transparent; font-size: 12px; }
.ap-per button.on { background: var(--card); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12); font-weight: 500; }
.ap-kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.ap-kpis > div { display: grid; gap: 0; padding: 8px 10px; border-radius: 14px; background: var(--card); border: 1px solid color-mix(in srgb, var(--ink) 8%, transparent); }
.ap-kpis .i { display: none; }
.ap-kpis b { font-weight: 500; font-size: 18px; line-height: 1.2; font-variant-numeric: tabular-nums; }
.ap-kpis em { font-style: normal; font-size: 12px; color: var(--mut); }
.ap-kpis small { color: var(--mut); font-size: 10.5px; }
.ap-card { padding: 10px 12px; border-radius: 16px; background: var(--card); border: 1px solid color-mix(in srgb, var(--ink) 8%, transparent); }
.ap-card :deep(.hd) { margin-bottom: 6px; font-size: 12px; }
.ap-facts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; }
.ap-facts div { display: grid; gap: 0; } .ap-facts small { color: var(--mut); font-size: 10.5px; } .ap-facts b { font-weight: 400; font-size: 13px; }
</style>
