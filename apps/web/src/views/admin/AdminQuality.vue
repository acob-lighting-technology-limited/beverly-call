<script setup lang="ts">
/** Quality and service: SLA, case funnel, callbacks and QA scores. Data: /wall, /cases, /callbacks, /qa/sample. Used by: AdminView. */
import { computed } from 'vue'
import type { Callback, QaSample, SupportCase, WallSnapshot } from '@beverly-call/shared'
import Icon from '@/components/Icon.vue'
import StateBanner from '@/components/StateBanner.vue'
import BarList from '@/components/charts/BarList.vue'
import Donut from '@/components/charts/Donut.vue'
import StatCard from '@/components/charts/StatCard.vue'
import type { Metric } from '@beverly-call/shared'
import { api } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { shortDate } from '@/lib/format'

const wall = useResource(() => api<WallSnapshot>('/wall'))
const cases = useResource(() => api<SupportCase[]>('/cases'))
const callbacks = useResource(() => api<Callback[]>('/callbacks'))
const qa = useResource(() => api<QaSample>('/qa/sample'))
const sl7 = useResource(() => api<Metric>('/metrics/service_level?period=7d'))
const over7 = useResource(() => api<Metric>('/metrics/overdue_cases?period=7d'))
const spark = (m: Metric | null): number[] => (m?.series ?? []).map((p) => p.value)

const caseCount = (s: SupportCase['state']): number => (cases.data.value ?? []).filter((c) => c.state === s).length
const funnel = computed(() => [
  { label: 'New', value: caseCount('New') },
  { label: 'Working', value: caseCount('Working') },
  { label: 'Overdue', value: caseCount('Overdue') },
  { label: 'Done', value: caseCount('Done') },
])
const cbCount = (s: Callback['status']): number => (callbacks.data.value ?? []).filter((c) => c.status === s).length
const cbSegments = computed(() => [
  { label: 'Overdue', value: cbCount('Overdue'), color: 'var(--danger)' },
  { label: 'Due now', value: cbCount('Due'), color: 'var(--st-break)' },
  { label: 'Later', value: cbCount('Later'), color: 'var(--t2)' },
])
const scored = computed(() => (qa.data.value ?? []).filter((q) => q.score !== null))
const avgScore = computed(() => (scored.value.length ? Math.round(scored.value.reduce((a, q) => a + (q.score ?? 0), 0) / scored.value.length) : null))
const resolvedPct = computed(() => { const t = (cases.data.value ?? []).length; return t ? Math.round((caseCount('Done') / t) * 100) : 0 })
</script>

<template>
  <div class="bento">
    <div class="stat-grid">
      <div class="c"><StatCard icon="check" label="Service level" :value="`${wall.data.value?.serviceLevelPct ?? 0}%`" :delta="sl7.data.value?.deltaPct ?? null" :spark="spark(sl7.data.value)" :sub="`Longest wait ${wall.data.value?.longestWaitSeconds ?? 0}s`" /></div>
      <div class="c"><StatCard icon="flag" label="Cases resolved" :value="`${resolvedPct}%`" :sub="`${wall.data.value?.openCases ?? 0} open`" /></div>
      <div class="c"><StatCard icon="alert" label="Past SLA" :value="wall.data.value?.overdueCases ?? 0" :delta="over7.data.value?.deltaPct ?? null" invert :spark="spark(over7.data.value)" /></div>
      <div class="c"><StatCard icon="pencil" label="QA score" :value="avgScore === null ? '—' : avgScore" :sub="`${scored.length} of ${qa.data.value?.length ?? 0} scored`" /></div>
    </div>

    <div class="c s6">
      <div class="hd"><Icon name="flag" /><b>Case funnel</b></div>
      <StateBanner :loading="cases.loading.value && !cases.data.value" :error="cases.error.value" what="cases" />
      <BarList :rows="funnel" />
    </div>
    <div class="c s6">
      <div class="hd"><Icon name="wait" /><b>Callbacks</b></div>
      <Donut :segments="cbSegments.filter((s) => s.value)" :center="String((callbacks.data.value ?? []).length)" sub="in queue" />
    </div>

    <div class="c s12 w2">
      <div class="hd"><Icon name="mic" /><b>Calls sampled for QA</b></div>
      <StateBanner :loading="qa.loading.value && !qa.data.value" :error="qa.error.value" what="the QA sample" />
      <div v-for="q in (qa.data.value ?? []).slice(0, 8)" :key="q.callId" class="row"><span>{{ shortDate(q.at) }}<small class="q-sub">{{ q.callId.slice(0, 8) }}</small></span><span class="pill" :class="q.score === null ? 'ye' : q.score >= 75 ? 'ok' : 'bad'">{{ q.score === null ? 'Not scored' : `${q.score}` }}</span></div>
      <p v-if="qa.data.value && !qa.data.value.length" class="q-sub">No calls sampled yet.</p>
    </div>
  </div>
</template>

<style scoped>
.q-sub { display: block; color: var(--text-muted); font-size: var(--fs-xs); }
</style>
