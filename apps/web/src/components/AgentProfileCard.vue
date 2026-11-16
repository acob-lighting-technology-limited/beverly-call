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
      <div class="ap-av" :style="photo ? { backgroundImage: `url(${photo})` } : {}">{{ photo ? '' : initials }}<i :class="{ on: data.online }" :title="data.online ? 'Online' : 'Offline'"></i></div>
      <b>{{ data.name }}</b>
      <span class="ap-sub">{{ data.role }} · {{ data.staffId }}</span>
      <slot name="actions" />
    </div>

    <div class="ss ap-per" role="group" aria-label="Period"><button v-for="p in PERIODS" :key="p[0]" :class="{ on: period === p[0] }" @click="period = p[0]">{{ p[1] }}</button></div>

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
      <div><small>Languages</small><b>{{ data.languages.map((l) => LANGUAGE_NAMES[l] ?? l).join(', ') || '—' }}</b></div>
      <div><small>Open cases</small><b>{{ data.openCases }}</b></div>
      <div><small>Open callbacks</small><b>{{ data.openCallbacks }}</b></div>
      <div><small>Quality score</small><b>{{ data.qa.average === null ? 'Not scored yet' : `${data.qa.average} of 100 (${data.qa.scored} calls)` }}</b></div>
    </div>
  </div>
</template>

<style scoped>
.ap { display: grid; gap: 12px; }
.ap-head { display: grid; justify-items: center; gap: 4px; text-align: center; padding: 8px 0 2px; }
.ap-head b { font-weight: 500; font-size: 18px; }
.ap-sub { color: var(--mut); font-size: 12px; }
.ap-av { position: relative; width: 84px; height: 84px; border-radius: 50%; display: grid; place-items: center; font-size: 26px; color: var(--on-accent); background: linear-gradient(135deg, var(--yel), color-mix(in srgb, var(--yel) 60%, #fff)) center/cover; box-shadow: 0 8px 22px rgba(0, 0, 0, 0.12); }
.ap-av i { position: absolute; right: 4px; bottom: 4px; width: 16px; height: 16px; border-radius: 50%; border: 3px solid var(--card); background: #9a9aa3; }
.ap-av i.on { background: #3fae6a; }
.ap-per { max-width: 320px; margin: 0 auto; }
.ap-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; }
.ap-kpis > div { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 0 8px; padding: 10px 12px; border-radius: 18px; background: var(--card); border: 1px solid color-mix(in srgb, var(--ink) 8%, transparent); }
.ap-kpis .i { grid-row: span 2; width: 28px; height: 28px; padding: 6px; border-radius: 50%; background: var(--yel); color: var(--on-accent); }
.ap-kpis b { font-weight: 500; font-size: 20px; font-variant-numeric: tabular-nums; }
.ap-kpis em { font-style: normal; font-size: 13px; color: var(--mut); }
.ap-kpis small { color: var(--mut); font-size: 11px; }
.ap-card { padding: 12px 14px; border-radius: 20px; background: var(--card); border: 1px solid color-mix(in srgb, var(--ink) 8%, transparent); }
.ap-facts { display: grid; gap: 10px; }
.ap-facts div { display: grid; gap: 1px; } .ap-facts small { color: var(--mut); font-size: 11px; } .ap-facts b { font-weight: 400; }
</style>
