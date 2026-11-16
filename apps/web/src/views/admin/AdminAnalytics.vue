<script setup lang="ts">
/** Call analytics: headline stats with trend, volume with trend line, busy hours, forecast, languages and top issues.
 *  Data: /reports, /reports/extras, /metrics/:key. Used by: AdminView. */
import { computed, ref, watch } from 'vue'
import { LANGUAGE_NAMES, type Metric, type MetricPeriod, type Report, type ReportExtras, type ReportRange } from '@beverly-call/shared'
import Icon from '@/components/Icon.vue'
import StateBanner from '@/components/StateBanner.vue'
import BarChart from '@/components/charts/BarChart.vue'
import BarList from '@/components/charts/BarList.vue'
import Donut from '@/components/charts/Donut.vue'
import Heatmap from '@/components/charts/Heatmap.vue'
import LineChart from '@/components/charts/LineChart.vue'
import StatCard from '@/components/charts/StatCard.vue'
import { api } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { clock, csvCell } from '@/lib/format'

const range = ref<ReportRange>('7')
const PERIOD: Record<ReportRange, MetricPeriod> = { '1': '24h', '7': '7d', '30': '30d' }
const rep = useResource(() => api<Report>(`/reports?range=${range.value}`))
const extras = useResource(() => api<ReportExtras>(`/reports/extras?range=${range.value}`))
const mCalls = useResource(() => api<Metric>(`/metrics/calls?period=${PERIOD[range.value]}`))
const mHandle = useResource(() => api<Metric>(`/metrics/handle_time?period=${PERIOD[range.value]}`))
const mSl = useResource(() => api<Metric>(`/metrics/service_level?period=${PERIOD[range.value]}`))
const mAband = useResource(() => api<Metric>(`/metrics/abandoned?period=${PERIOD[range.value]}`))
watch(range, () => { for (const r of [rep, extras, mCalls, mHandle, mSl, mAband]) void r.reload() })

const RANGES: { id: ReportRange; label: string }[] = [{ id: '1', label: 'Today' }, { id: '7', label: '7 days' }, { id: '30', label: '30 days' }]
const spark = (m: Metric | null): number[] => (m?.series ?? []).map((p) => p.value)
const volume = computed(() => (rep.data.value?.buckets ?? []).map((b) => ({ label: b.label, value: b.calls })))
const forecast = computed(() => (extras.data.value?.forecast ?? []).map((f) => ({ label: f.day, value: f.calls })))
const issues = computed(() => (rep.data.value?.topIssues ?? []).map((i) => ({ label: i.issue, value: i.count })))
const PALETTE = ['var(--accent)', 'var(--t1)', 'var(--t2)', 'var(--st-break)', 'var(--st-away)']
const languages = computed(() => (extras.data.value?.languages ?? []).map((l, i) => ({ label: LANGUAGE_NAMES[l.language] ?? l.language, value: l.count, color: PALETTE[i % PALETTE.length]! })))
const langTotal = computed(() => languages.value.reduce((a, l) => a + l.value, 0))
const mmss = (n: number): string => clock(Math.round(n))

function exportCsv(): void {
  const d = rep.data.value
  if (!d) return
  const text = ['period,calls', ...d.buckets.map((b) => `${csvCell(b.label)},${b.calls}`)].join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  a.download = `calls-${range.value}d.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}
</script>

<template>
  <div class="bento">
    <div class="c s12 w2 an-bar">
      <div class="ss an-range" role="group" aria-label="Range"><button v-for="r in RANGES" :key="r.id" :class="{ on: range === r.id }" @click="range = r.id">{{ r.label }}</button></div>
      <button class="an-export" aria-label="Export call volume as CSV" title="Export CSV" :disabled="!rep.data.value" @click="exportCsv"><Icon name="dl" /></button>
    </div>

    <div class="stat-grid">
      <div class="c"><StatCard icon="phone" label="Calls" :value="rep.data.value?.calls ?? 0" :delta="mCalls.data.value?.deltaPct ?? null" :spark="spark(mCalls.data.value)" /></div>
      <div class="c"><StatCard icon="clock" label="Handle time" :value="clock(rep.data.value?.avgHandleSeconds ?? 0)" :delta="mHandle.data.value?.deltaPct ?? null" invert :spark="spark(mHandle.data.value)" /></div>
      <div class="c"><StatCard icon="check" label="Service level" :value="`${extras.data.value?.serviceLevelPct ?? 0}%`" :delta="mSl.data.value?.deltaPct ?? null" :spark="spark(mSl.data.value)" :sub="`Solved first call ${rep.data.value?.firstCallResolvedPct ?? 0}%`" /></div>
      <div class="c"><StatCard icon="alert" label="Abandoned" :value="`${extras.data.value?.abandonedPct ?? 0}%`" :delta="mAband.data.value?.deltaPct ?? null" invert :spark="spark(mAband.data.value)" :sub="extras.data.value?.avgCostNgn == null ? undefined : `Cost per call NGN ${extras.data.value.avgCostNgn}`" /></div>
    </div>

    <StateBanner :loading="rep.loading.value && !rep.data.value" :error="rep.error.value" what="analytics" />

    <div class="c s8 w2"><div class="hd"><Icon name="phone" /><b>Call volume</b><small class="an-note">bars with 3-point trend</small></div><BarChart :items="volume" :height="170" trend label="Call volume" /></div>
    <div class="c s4"><div class="hd"><Icon name="flag" /><b>Top issues</b></div><BarList v-if="issues.length" :rows="issues" /><p v-else class="an-empty">No tickets in this period.</p></div>

    <div class="c s8 w2"><div class="hd"><Icon name="clock" /><b>Busy hours, last 4 weeks</b></div><Heatmap v-if="extras.data.value" :matrix="extras.data.value.heatmap" /></div>
    <div class="c s4"><div class="hd"><Icon name="auto" /><b>Next 7 days, forecast</b></div><BarChart :items="forecast" :height="130" :average="false" label="Forecast calls per day" /></div>

    <div class="c s6"><div class="hd"><Icon name="chart" /><b>Average handle time</b></div>
      <LineChart v-if="spark(mHandle.data.value).length" :series="mHandle.data.value?.series ?? []" :format="mmss" label="Average handle time" :height="140" /></div>
    <div class="c s6"><div class="hd"><Icon name="globe" /><b>Languages</b></div><Donut v-if="languages.length" :segments="languages" :center="String(langTotal)" sub="calls" /><p v-else class="an-empty">No calls in this period.</p></div>
  </div>
</template>

<style scoped>
.an-bar { display: flex; align-items: center; gap: var(--sp-2); }
.an-range { margin: 0; max-width: 340px; flex: 1; }
.an-export { margin-left: auto; }
.an-note { margin-left: auto; color: var(--text-muted); font-size: var(--fs-xs); }
.an-empty { color: var(--text-muted); margin: 0; }
</style>
