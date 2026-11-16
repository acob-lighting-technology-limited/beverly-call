<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { LANGUAGE_NAMES, type QaSample, type Report, type ReportExtras, type ReportRange } from '@beverly-call/shared'
import Icon from '@/components/Icon.vue'
import KpiTile from '@/components/KpiTile.vue'
import Modal from '@/components/Modal.vue'
import StateBanner from '@/components/StateBanner.vue'
import BarChart from '@/components/charts/BarChart.vue'
import BarList from '@/components/charts/BarList.vue'
import Heatmap from '@/components/charts/Heatmap.vue'
import { api } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { csvCell, shortDate } from '@/lib/format'
import { useToast } from '@/stores/toast'

const toast = useToast()
const range = ref<ReportRange>('7')
const rep = useResource(() => api<Report>(`/reports?range=${range.value}`))
const extras = useResource(() => api<ReportExtras>(`/reports/extras?range=${range.value}`))
const qa = useResource(() => api<QaSample>('/qa/sample'))
watch(range, () => { void rep.reload(); void extras.reload() })

const label = computed(() => ({ '1': 'Calls today', '7': 'Calls, 7 days', '30': 'Calls, 30 days' })[range.value])
const handle = computed(() => { const s = rep.data.value?.avgHandleSeconds ?? 0; return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` })

function downloadCsv(): void {
  const d = rep.data.value
  if (!d) return
  const text = ['period,calls', ...d.buckets.map((b) => `${csvCell(b.label)},${b.calls}`)].join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  a.download = `calls-${range.value}d.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

const printPage = (): void => window.print()

/* ---- QA scoring ---- */
const scoring = ref<QaSample[number] | null>(null)
const score = ref(80)
const qnote = ref('')
function startScore(s: QaSample[number]): void { scoring.value = s; score.value = s.score ?? 80; qnote.value = '' }
async function saveScore(): Promise<void> {
  if (!scoring.value) return
  try { await api(`/qa/${scoring.value.callId}`, { method: 'POST', body: JSON.stringify({ score: score.value, notes: qnote.value }) }); toast.show('Score saved. The agent is told.'); scoring.value = null; void qa.reload() }
  catch { toast.show('Could not save the score') }
}
</script>

<template>
  <section>
    <div v-sticky-head class="head"><div class="ht"><h1>Reports</h1>
      <div class="ss" style="margin: 0; width: 190px" role="group" aria-label="Range"><button v-for="r in (['1', '7', '30'] as ReportRange[])" :key="r" :class="{ on: range === r }" @click="range = r">{{ r === '1' ? 'Today' : `${r}d` }}</button></div></div>
      <div v-if="rep.data.value" v-hover-scroll class="kp">
        <KpiTile icon="phone" :value="rep.data.value.calls" :label="label" metric="calls" />
        <KpiTile icon="clock" :value="handle" label="Handle time" dark metric="handle_time" />
        <KpiTile icon="check" :value="`${rep.data.value.firstCallResolvedPct}%`" label="Solved first call" />
        <KpiTile icon="wallet" :value="extras.data.value?.avgCostNgn == null ? 'n/a' : extras.data.value.avgCostNgn" label="NGN per call" dark />
      </div>
    </div>
    <StateBanner :loading="rep.loading.value && !rep.data.value" :error="rep.error.value" what="the report" />
    <div v-if="rep.data.value" class="bento">
      <div class="c s8 w2">
        <div class="hd"><Icon name="chart" /><b>Calls by {{ range === '1' ? 'hour' : 'day' }}</b></div>
        <BarChart v-if="rep.data.value.buckets.length" :items="rep.data.value.buckets.map((b) => ({ label: b.label, value: b.calls }))" :height="170" trend :label="`Calls by ${range === '1' ? 'hour' : 'day'}`" />
        <div v-else style="color: var(--mut)">No calls in this period.</div>
        <div class="btns"><button aria-label="Download CSV" title="Download CSV" @click="downloadCsv"><Icon name="dl" /></button><button aria-label="Print or save as PDF" title="Print or save as PDF" @click="printPage"><Icon name="print" /></button></div>
      </div>
      <div class="c s4 w2 stick"><div class="hd"><Icon name="flag" /><b>Top issues</b></div>
        <BarList v-if="rep.data.value.topIssues.length" :rows="rep.data.value.topIssues.map((i) => ({ label: i.issue, value: i.count }))" />
        <div v-else style="color: var(--mut)">No cases in this period.</div></div>

      <template v-if="extras.data.value">
        <div class="c s6 w2"><div class="hd"><Icon name="grid" /><b>Busy hours</b></div><Heatmap :matrix="extras.data.value.heatmap" /><small style="color: var(--mut)">Last 4 weeks, by hour of day.</small></div>
        <div class="c s6 w2"><div class="hd"><Icon name="chart" /><b>Forecast, next 7 days</b></div>
          <BarChart :items="extras.data.value.forecast.map((f) => ({ label: f.day, value: f.calls }))" :height="130" :average="false" label="Forecast calls per day" />
          <small style="color: var(--mut)">Average of the same weekday over the last four weeks.</small></div>
        <div class="c s6 w2"><div class="hd"><Icon name="users" /><b>Leaderboard</b></div>
          <template v-for="l in extras.data.value.leaderboard" :key="l.agentId"><div style="display: flex; justify-content: space-between"><span>{{ l.name }}</span><small style="color: var(--mut)">{{ l.calls }} calls{{ l.avgRating ? ` · ${l.avgRating} / 5` : '' }}</small></div><div class="tr2"><i :style="{ width: `${(l.calls / Math.max(1, extras.data.value.leaderboard[0]?.calls ?? 1)) * 100}%` }"></i></div></template>
          <div v-if="!extras.data.value.leaderboard.length" style="color: var(--mut)">No calls in this period.</div>
          <div class="row"><span>Service level</span><span>{{ extras.data.value.serviceLevelPct }}%</span></div><div class="row"><span>Abandoned</span><span>{{ extras.data.value.abandonedPct }}%</span></div>
          <div v-for="l in extras.data.value.languages" :key="l.language" class="row"><span>{{ LANGUAGE_NAMES[l.language] }}</span><span>{{ l.count }}</span></div></div>
      </template>
      <div class="c s6 w2"><div class="hd"><Icon name="check" /><b>QA sample</b></div>
        <StateBanner :loading="qa.loading.value" :error="qa.error.value" what="the QA sample" />
        <div v-for="s in qa.data.value ?? []" :key="s.callId" class="row"><span>{{ shortDate(s.at) }} {{ s.agentId.slice(0, 8) }}</span>
          <button :class="s.score === null ? 'y' : ''" style="height: 30px" :aria-label="s.score === null ? 'Score this call' : `Change score ${s.score}`" @click="startScore(s)">{{ s.score === null ? 'Score' : s.score }}</button></div>
        <p v-if="qa.data.value && !qa.data.value.length" style="color: var(--mut)">No finished calls to review yet.</p></div>
    </div>

    <Modal :open="!!scoring" title="Score this call" @close="scoring = null">
      <label class="sw"><span>Score</span><b>{{ score }}</b></label>
      <input v-model.number="score" type="range" min="0" max="100" aria-label="Score" />
      <label class="fl">Notes for the agent<textarea v-model="qnote" rows="2" maxlength="500"></textarea></label>
      <template #footer><button @click="scoring = null">Cancel</button><button class="y" @click="saveScore">Save score</button></template>
    </Modal>
  </section>
</template>

