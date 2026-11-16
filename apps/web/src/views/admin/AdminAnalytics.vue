<script setup lang="ts">
/** Call analytics: volume, busy hours, 7-day forecast, languages, cost and top issues.
 *  Data: /reports, /reports/extras. Used by: AdminView. */
import { computed, ref, watch } from 'vue'
import { LANGUAGE_NAMES, type Report, type ReportExtras, type ReportRange } from '@beverly-call/shared'
import Icon from '@/components/Icon.vue'
import StateBanner from '@/components/StateBanner.vue'
import BarChart from '@/components/charts/BarChart.vue'
import BarList from '@/components/charts/BarList.vue'
import Heatmap from '@/components/charts/Heatmap.vue'
import { api } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { clock, csvCell } from '@/lib/format'

const range = ref<ReportRange>('7')
const rep = useResource(() => api<Report>(`/reports?range=${range.value}`))
const extras = useResource(() => api<ReportExtras>(`/reports/extras?range=${range.value}`))
watch(range, () => { void rep.reload(); void extras.reload() })

const RANGES: { id: ReportRange; label: string }[] = [{ id: '1', label: 'Today' }, { id: '7', label: '7 days' }, { id: '30', label: '30 days' }]
const volume = computed(() => (rep.data.value?.buckets ?? []).map((b) => ({ label: b.label, value: b.calls })))
const forecast = computed(() => (extras.data.value?.forecast ?? []).map((f) => ({ label: f.day, value: f.calls })))
const issues = computed(() => (rep.data.value?.topIssues ?? []).map((i) => ({ label: i.issue, value: i.count })))
const languages = computed(() => (extras.data.value?.languages ?? []).map((l) => ({ label: LANGUAGE_NAMES[l.language] ?? l.language, value: l.count })))

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

    <div class="c s3"><div class="hd"><Icon name="phone" /><b>Calls</b></div><div class="kn">{{ rep.data.value?.calls ?? 0 }}</div></div>
    <div class="c s3"><div class="hd"><Icon name="clock" /><b>Handle time</b></div><div class="kn">{{ clock(rep.data.value?.avgHandleSeconds ?? 0) }}</div></div>
    <div class="c s3"><div class="hd"><Icon name="check" /><b>Solved first call</b></div><div class="kn">{{ rep.data.value?.firstCallResolvedPct ?? 0 }}%</div></div>
    <div class="c s3"><div class="hd"><Icon name="wallet" /><b>Cost per call</b></div><div class="kn">{{ extras.data.value?.avgCostNgn == null ? '—' : `NGN ${extras.data.value.avgCostNgn}` }}</div></div>

    <StateBanner :loading="rep.loading.value && !rep.data.value" :error="rep.error.value" what="analytics" />

    <div class="c s8 w2"><div class="hd"><Icon name="phone" /><b>Call volume</b></div><BarChart :items="volume" :height="150" label="Call volume" /></div>
    <div class="c s4"><div class="hd"><Icon name="flag" /><b>Top issues</b></div><BarList v-if="issues.length" :rows="issues" /><p v-else class="an-empty">No tickets in this period.</p></div>

    <div class="c s8 w2"><div class="hd"><Icon name="clock" /><b>Busy hours, last 4 weeks</b></div><Heatmap v-if="extras.data.value" :matrix="extras.data.value.heatmap" /></div>
    <div class="c s4"><div class="hd"><Icon name="auto" /><b>Next 7 days, forecast</b></div><BarChart :items="forecast" :height="110" label="Forecast calls per day" /></div>

    <div class="c s6"><div class="hd"><Icon name="globe" /><b>Languages</b></div><BarList v-if="languages.length" :rows="languages" /><p v-else class="an-empty">No calls in this period.</p></div>
  </div>
</template>

<style scoped>
.an-bar { display: flex; align-items: center; gap: var(--sp-2); }
.an-range { margin: 0; max-width: 340px; flex: 1; }
.an-export { margin-left: auto; }
.an-empty { color: var(--text-muted); margin: 0; }
</style>
