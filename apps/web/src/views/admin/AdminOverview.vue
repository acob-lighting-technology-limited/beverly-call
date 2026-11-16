<script setup lang="ts">
/** Admin overview: the live call pipeline, today's headline numbers and trends.
 *  Data: /wall (polled), /presence, /reports, /metrics/:key. Used by: AdminView. */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { Callback, Metric, PresenceRow, Recording, Report, SupportCase, WallSnapshot } from '@beverly-call/shared'
import Icon from '@/components/Icon.vue'
import Modal from '@/components/Modal.vue'
import StateBanner from '@/components/StateBanner.vue'
import LineChart from '@/components/charts/LineChart.vue'
import BarChart from '@/components/charts/BarChart.vue'
import Donut from '@/components/charts/Donut.vue'
import { api } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { clock, pad2, shortDate } from '@/lib/format'

const wall = useResource(() => api<WallSnapshot>('/wall'))
const presence = useResource(() => api<PresenceRow[]>('/presence'))
const today = useResource(() => api<Report>('/reports?range=1'))
const calls24 = useResource(() => api<Metric>('/metrics/calls?period=24h'))
const callbacks = useResource(() => api<Callback[]>('/callbacks'))
const cases = useResource(() => api<SupportCase[]>('/cases'))
const recordings = useResource(() => api<Recording[]>('/recordings'))
const router = useRouter()

// The pipeline is live: refresh every 15 seconds while the tab is visible.
let timer = 0
onMounted(() => { timer = window.setInterval(() => { if (!document.hidden) { void wall.reload(); void presence.reload(); void cases.reload(); void callbacks.reload() } }, 15_000) })
onBeforeUnmount(() => clearInterval(timer))

const w = computed(() => wall.data.value)
const byStatus = computed(() => {
  const m = { available: 0, busy: 0, acw: 0, break: 0, away: 0 }
  for (const p of presence.data.value ?? []) if (p.online) m[p.status] += 1
  return m
})
const stages = computed(() => [
  { id: 'in', label: 'Calls today', value: today.data.value?.calls ?? 0, icon: 'phone', tone: '' },
  { id: 'q', label: 'Callbacks queued', value: w.value?.waitingCallbacks ?? 0, icon: 'wait', tone: (w.value?.waitingCallbacks ?? 0) > 5 ? 'warn' : '' },
  { id: 'live', label: 'On a call', value: w.value?.activeCalls ?? 0, icon: 'mic', tone: '' },
  { id: 'wrap', label: 'Wrapping up', value: byStatus.value.acw, icon: 'note', tone: '' },
  { id: 'cases', label: 'Open cases', value: w.value?.openCases ?? 0, icon: 'flag', tone: '' },
  { id: 'late', label: 'Past SLA', value: w.value?.overdueCases ?? 0, icon: 'alert', tone: (w.value?.overdueCases ?? 0) > 0 ? 'bad' : '' },
  { id: 'done', label: 'Resolved cases', value: (cases.data.value ?? []).filter((c) => c.state === 'Done').length, icon: 'check', tone: '' },
])

/* ---- Stage drill-down: tap a stage to see what is in it and jump to where it is handled ---- */
interface DetailRow { key: string; title: string; sub: string; tag: string; tone: string }
interface Detail { title: string; rows: DetailRow[]; empty: string; to: string; action: string }
const open = ref<string | null>(null)
const caseTone: Record<string, string> = { Overdue: 'bad', Working: 'ye', New: 'vi', Done: 'ok' }
const caseRow = (c: SupportCase): DetailRow => ({ key: c.id, title: c.id + ' · ' + c.issue, sub: c.customer + ' · held by ' + c.by, tag: c.state, tone: caseTone[c.state] ?? 'vi' })
const detail = computed<Detail | null>(() => {
  switch (open.value) {
    case 'in': return { title: 'Calls today', empty: 'No recordings yet today.', to: '/rec', action: 'Open recordings',
      rows: (recordings.data.value ?? []).slice(0, 12).map((r) => ({ key: r.id, title: r.caller, sub: shortDate(r.date), tag: clock(r.seconds), tone: 'vi' })) }
    case 'q': return { title: 'Callbacks queued', empty: 'No callbacks waiting.', to: '/cb', action: 'Open callbacks',
      rows: (callbacks.data.value ?? []).map((c) => ({ key: c.id, title: c.name, sub: c.time + ' · ' + c.language, tag: c.status, tone: c.status === 'Overdue' ? 'bad' : c.status === 'Due' ? 'ye' : 'vi' })) }
    case 'live': return { title: 'On a call', empty: 'No live calls.', to: '/wall', action: 'Open live wall',
      rows: (w.value?.calls ?? []).map((c) => ({ key: c.id, title: c.agentName, sub: c.caller, tag: clock(c.seconds), tone: 'vi' })) }
    case 'wrap': return { title: 'Wrapping up', empty: 'Nobody is in wrap-up.', to: '/wall', action: 'Open live wall',
      rows: (presence.data.value ?? []).filter((p) => p.online && p.status === 'acw').map((p) => ({ key: p.agentId, title: p.name, sub: 'In wrap-up', tag: clock(p.sinceSeconds), tone: 'vi' })) }
    case 'cases': return { title: 'Open cases', empty: 'No open cases.', to: '/cases', action: 'Open escalations',
      rows: (cases.data.value ?? []).filter((c) => c.state !== 'Done').map(caseRow) }
    case 'late': return { title: 'Past SLA', empty: 'Nothing is past its deadline.', to: '/cases', action: 'Open escalations',
      rows: (cases.data.value ?? []).filter((c) => c.state === 'Overdue').map(caseRow) }
    case 'done': return { title: 'Resolved cases', empty: 'Nothing resolved yet.', to: '/cases', action: 'Open escalations',
      rows: (cases.data.value ?? []).filter((c) => c.state === 'Done').slice(0, 12).map(caseRow) }
    default: return null
  }
})
function openFull(): void { const to = detail.value?.to; open.value = null; if (to) void router.push(to) }
const handle = computed(() => clock(today.data.value?.avgHandleSeconds ?? 0))
const hourly = computed(() => (w.value?.hourly ?? []).map((n, h) => ({ label: String(h).padStart(2, '0'), value: n })))
const agentSegments = computed(() => [
  { label: 'Available', value: byStatus.value.available, color: 'var(--st-on)' },
  { label: 'On a call', value: byStatus.value.busy, color: 'var(--t1)' },
  { label: 'Wrap-up', value: byStatus.value.acw, color: 'var(--t2)' },
  { label: 'Break', value: byStatus.value.break, color: 'var(--st-break)' },
  { label: 'Away', value: byStatus.value.away, color: 'var(--st-away)' },
])
const online = computed(() => agentSegments.value.reduce((a, s) => a + s.value, 0))
</script>

<template>
  <div class="bento">
    <!-- Pipeline: where every call is right now -->
    <div class="c s12 w2 pipe">
      <div class="hd"><Icon name="fwd" /><b>Call pipeline</b><span class="pill ok live">Live</span></div>
      <StateBanner :loading="wall.loading.value && !wall.data.value" :error="wall.error.value" what="the pipeline" />
      <ol class="pipe-row">
        <li v-for="(s, i) in stages" :key="s.id">
          <button type="button" class="pipe-st" :class="s.tone" :aria-label="`${s.label}: ${s.value}. Show details`" @click="open = s.id">
            <span class="pipe-ic"><Icon :name="s.icon" /></span>
            <b>{{ pad2(s.value) }}</b><small>{{ s.label }}</small>
          </button>
          <i v-if="i < stages.length - 1" class="pipe-arrow" aria-hidden="true"></i>
        </li>
      </ol>
    </div>

    <div class="c s4">
      <div class="hd"><Icon name="check" /><b>Service level</b></div>
      <Donut :segments="[{ label: 'Within 20s', value: w?.serviceLevelPct ?? 0, color: 'var(--accent)' }, { label: 'Slower', value: 100 - (w?.serviceLevelPct ?? 0), color: 'color-mix(in srgb, var(--text) 18%, transparent)' }]" :center="`${w?.serviceLevelPct ?? 0}%`" sub="answered in time" />
      <div class="row"><span>Abandoned</span><b>{{ w?.abandonedPct ?? 0 }}%</b></div>
      <div class="row"><span>Longest wait</span><b>{{ w?.longestWaitSeconds ?? 0 }}s</b></div>
    </div>

    <div class="c s4">
      <div class="hd"><Icon name="users" /><b>Agents online</b></div>
      <Donut :segments="agentSegments.filter((s) => s.value)" :center="String(online)" sub="signed in" />
    </div>

    <div class="c s4">
      <div class="hd"><Icon name="clock" /><b>Today</b></div>
      <div class="row"><span>Calls</span><b>{{ today.data.value?.calls ?? 0 }}</b></div>
      <div class="row"><span>Average handle time</span><b>{{ handle }}</b></div>
      <div class="row"><span>Solved on first call</span><b>{{ today.data.value?.firstCallResolvedPct ?? 0 }}%</b></div>
      <div class="row"><span>Open callbacks</span><b>{{ w?.waitingCallbacks ?? 0 }}</b></div>
    </div>

    <div class="c s6">
      <div class="hd"><Icon name="phone" /><b>Calls, last 24 hours</b><span v-if="calls24.data.value" class="pill" :class="calls24.data.value.deltaPct >= 0 ? 'ok' : 'bad'">{{ calls24.data.value.deltaPct >= 0 ? 'Up' : 'Down' }} {{ Math.abs(calls24.data.value.deltaPct) }}%</span></div>
      <LineChart :series="calls24.data.value?.series ?? []" label="Calls in the last 24 hours" />
    </div>
    <div class="c s6">
      <div class="hd"><Icon name="clock" /><b>Calls per hour, today</b></div>
      <BarChart :items="hourly" label="Calls per hour today" />
    </div>

    <Modal :open="!!detail" :title="detail?.title ?? ''" @close="open = null">
      <template v-if="detail">
        <div v-for="r in detail.rows" :key="r.key" class="row"><span>{{ r.title }}<small class="pipe-sub">{{ r.sub }}</small></span><span class="pill" :class="r.tone">{{ r.tag }}</span></div>
        <p v-if="!detail.rows.length" class="pipe-sub">{{ detail.empty }}</p>
      </template>
      <template #footer><button class="y" @click="openFull">{{ detail?.action }}</button></template>
    </Modal>

    <div v-if="w?.alerts.length" class="c dk s12 w2">
      <div class="hd"><Icon name="alert" /><b>Needs attention</b></div>
      <div v-for="a in w.alerts" :key="a" class="row"><span>{{ a }}</span></div>
    </div>
  </div>
</template>

<style scoped>
.pipe-row { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: var(--sp-2); }
.pipe-row > li { position: relative; }
.pipe-st { position: relative; display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; gap: 0 var(--sp-2); align-items: center; justify-items: start; width: 100%; height: auto; min-width: 0; padding: var(--sp-3); text-align: left; border-radius: var(--r-md); background: color-mix(in srgb, var(--text) 5%, transparent); color: var(--text); transition: background var(--dur-fast), transform var(--dur-base) var(--ease-spring); }
.pipe-st:hover { background: color-mix(in srgb, var(--accent) 18%, transparent); }
.pipe-st:active { transform: scale(0.97); }
.pipe-sub { display: block; color: var(--text-muted); font-size: var(--fs-xs); margin: 2px 0 0; }
.pipe-ic { grid-row: span 2; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: var(--accent); color: var(--on-accent-text); }
.pipe-st b { font-size: 24px; font-weight: var(--fw-light); line-height: 1; font-variant-numeric: tabular-nums; }
.pipe-st small { color: var(--text-muted); font-size: var(--fs-xs); }
.pipe-st.bad, .pipe-st.bad:hover { background: var(--danger-bg); } .pipe-st.bad b { color: var(--danger-fg); }
.pipe-st.warn, .pipe-st.warn:hover { background: var(--warn-bg); }
.pipe-arrow { display: none; }
@media (min-width: 900px) {
  .pipe-arrow { display: block; position: absolute; right: -9px; top: 50%; width: 8px; height: 8px; border-top: 2px solid var(--text-muted); border-right: 2px solid var(--text-muted); transform: translateY(-50%) rotate(45deg); opacity: .5; z-index: 1; }
}
.live::before { animation: pulse-dot 1.6s ease-in-out infinite; }
@keyframes pulse-dot { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .live::before { animation: none; } }
</style>
