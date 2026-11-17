<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { LANGUAGE_NAMES, type CoachingEntry, type LanguageCode, type PresenceRow, type WallSnapshot } from '@beverly-call/shared'
import Icon from '@/components/Icon.vue'
import Donut from '@/components/charts/Donut.vue'
import BarChart from '@/components/charts/BarChart.vue'
import EmptyState from '@/components/EmptyState.vue'
import KpiTile from '@/components/KpiTile.vue'
import StateBanner from '@/components/StateBanner.vue'
import FilterPopover, { type FilterGroup } from '@/components/FilterPopover.vue'
import ViewToggle, { type ViewMode } from '@/components/ViewToggle.vue'
import { useViewMode } from '@/lib/use-view-mode'
import { api } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { clock, pad2, shortDate } from '@/lib/format'
import { maskPhone } from '@/lib/mask'
import { useSettings } from '@/stores/settings'
import { useToast } from '@/stores/toast'

const settings = useSettings()
const toast = useToast()
const wall = useResource(() => api<WallSnapshot>('/wall'))
const roster = useResource(() => api<PresenceRow[]>('/presence'))
const coaching = useResource(() => api<CoachingEntry[]>('/coaching'))
let t = 0
// Refresh quietly every 15s while the screen is open; skipped when the tab is hidden.
onMounted(() => { t = window.setInterval(() => { if (!document.hidden) { void wall.reload(); void roster.reload() } }, 15000) })
onBeforeUnmount(() => clearInterval(t))

/* ---- agents: search, filter, card or table ---- */
const VIEW_KEY = 'bc.wall.view'
const { mode: callsMode, set: setCallsMode } = useViewMode('wall-calls')
const view = ref<ViewMode>((() => { try { return (localStorage.getItem(VIEW_KEY) as ViewMode) || 'cards' } catch { return 'cards' } })())
const setView = (v: ViewMode): void => { view.value = v; try { localStorage.setItem(VIEW_KEY, v) } catch { /* storage blocked */ } }
const q = ref('')
const filters = ref<Record<string, string[]>>({})
const selected = ref<string | null>(null)

interface Row { id: string; name: string; langs: LanguageCode[]; state: 'Busy' | 'Wrap' | 'Free' | 'Break' | 'Away' | 'Offline'; tone: string; since: number; onCall: boolean }
const STATE: Record<string, { label: Row['state']; tone: string }> = { busy: { label: 'Busy', tone: 'bad' }, acw: { label: 'Wrap', tone: 'ye' }, available: { label: 'Free', tone: 'ok' }, break: { label: 'Break', tone: 'vi' }, away: { label: 'Away', tone: 'vi' } }
// admins can set a status but are not agents: they are not on the wall, cannot be coached or listened to
const rows = computed<Row[]>(() => (roster.data.value ?? []).filter((a) => !a.admin).map((a) => {
  const s = a.online ? STATE[a.status] ?? { label: 'Away' as const, tone: 'vi' } : { label: 'Offline' as const, tone: 'vi' }
  return { id: a.agentId, name: a.name, langs: a.languages, state: s.label, tone: s.tone, since: a.sinceSeconds, onCall: a.status === 'busy' && a.online }
}))
const groups = computed<FilterGroup[]>(() => [
  { key: 'state', label: 'State', options: ['Free', 'Busy', 'Wrap', 'Break', 'Away', 'Offline'] },
  { key: 'lang', label: 'Language', options: Object.values(LANGUAGE_NAMES) },
])
const shown = computed(() => rows.value.filter((r) =>
  (!q.value || r.name.toLowerCase().includes(q.value.toLowerCase())) &&
  (!(filters.value.state?.length) || filters.value.state.includes(r.state)) &&
  (!(filters.value.lang?.length) || r.langs.some((l) => filters.value.lang!.includes(LANGUAGE_NAMES[l])))))
const sel = computed(() => rows.value.find((r) => r.id === selected.value) ?? null)
const firstName = (n: string): string => n.split(' ')[0] ?? n

/* ---- supervisor tools ---- */
type Mode = 'listen' | 'whisper' | 'barge'
const mode = ref<Mode | null>(null)
const prompt = ref('')
const NOTE: Record<Mode, string> = { listen: 'Listening to @. The agent cannot hear you.', whisper: 'Whispering to @. The customer cannot hear you.', barge: 'Barged in on @. Everyone can hear you.' }
async function monitor(m: Mode, agent: Row | null = sel.value): Promise<void> {
  if (!agent) { toast.show('Choose an agent first'); return }
  selected.value = agent.id
  try {
    if (mode.value === m) { await api('/monitor', { method: 'POST', body: JSON.stringify({ mode: 'end', agentId: agent.id }) }); mode.value = null; void coaching.reload(); return }
    await api('/monitor', { method: 'POST', body: JSON.stringify({ mode: m, agentId: agent.id }) })
    mode.value = m; void coaching.reload()
  } catch { toast.show(`${firstName(agent.name)} is not on a call`) }
}
async function sendPrompt(): Promise<void> {
  if (!sel.value) { toast.show('Choose an agent first'); return }
  if (!prompt.value.trim()) { toast.show('Type a prompt first'); return }
  try { await api('/coaching', { method: 'POST', body: JSON.stringify({ agentId: sel.value.id, text: prompt.value.trim() }) }); toast.show(`Prompt sent to ${sel.value.name}`); prompt.value = ''; void coaching.reload() }
  catch { toast.show('Could not send the prompt') }
}

/* ---- charts ---- */
const langCounts = computed(() => {
  const m = new Map<LanguageCode, number>()
  for (const r of rows.value) for (const l of r.langs) m.set(l, (m.get(l) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
})
const PALETTE = ['var(--accent)', 'var(--t1)', 'var(--t2)', 'var(--st-break)', 'var(--st-away)']
const langSegments = computed(() => langCounts.value.map(([l, c], i) => ({ label: LANGUAGE_NAMES[l], value: c, color: PALETTE[i % PALETTE.length]! })))
const hourly = computed(() => (wall.data.value?.hourly ?? []).map((n, h) => ({ label: pad2(h), value: n })))
const free = computed(() => rows.value.filter((r) => r.state === 'Free').length)
const show = (p: string) => (settings.p.mask ? maskPhone(p) : p)
</script>

<template>
  <section>
    <div v-sticky-head class="head"><div class="ht"><h1>Live wall</h1><span class="chip" id="live"><i class="ld2"></i><span>Live</span></span></div>
      <div v-if="wall.data.value" v-hover-scroll class="kp">
        <KpiTile icon="phone" :value="pad2(wall.data.value.activeCalls)" label="Active calls" metric="calls" />
        <KpiTile icon="wait" :value="pad2(wall.data.value.waitingCallbacks)" label="Callbacks waiting" dark />
        <KpiTile icon="users" :value="pad2(free)" label="Agents free" />
        <KpiTile icon="check" :value="`${wall.data.value.serviceLevelPct}%`" label="Service level" metric="service_level" dark />
        <KpiTile icon="alert" :value="`${wall.data.value.abandonedPct}%`" label="Abandoned" metric="abandoned" />
        <KpiTile icon="flag" :value="pad2(wall.data.value.overdueCases)" label="Overdue cases" metric="overdue_cases" dark />
      </div>
    </div>
    <StateBanner :loading="wall.loading.value && !wall.data.value" :error="wall.error.value" what="the live wall" />
    <div v-if="wall.data.value" class="bento">
      <div class="c s8 w2">
        <div class="hd"><Icon name="users" /><b>Agents</b></div>
        <div class="dtb">
          <label class="sch"><Icon name="x-srch" /><input v-model="q" type="search" aria-label="Search agents" placeholder="Search agents" /></label>
          <span class="n" aria-live="polite">{{ shown.length }} {{ shown.length === 1 ? 'agent' : 'agents' }}</span>
          <FilterPopover v-model="filters" :groups="groups" /><ViewToggle :model-value="view" @update:model-value="setView" />
        </div>

        <div v-if="view === 'cards'" class="cgrid" role="list">
          <div v-for="r in shown" :key="r.id" class="cc2 agc" role="listitem" tabindex="0" :class="{ sel: r.id === selected }" :aria-label="`${r.name}, ${r.state}`" @click="selected = r.id" @keydown.enter="selected = r.id">
            <span class="cav" style="background: var(--yel)">{{ r.name.split(' ').map((w) => w[0]).join('').slice(0, 2) }}</span>
            <b>{{ r.name }}</b>
            <span class="wl"><span class="pill" :class="r.tone">{{ r.state }}</span><small>{{ clock(r.since) }}</small></span>
            <small>{{ r.langs.map((l) => l.toUpperCase()).join(' ') }}</small>
            <span class="ft">
              <button :class="{ y: mode === 'listen' && r.id === selected }" aria-label="Listen" title="Listen" :disabled="!r.onCall" @click.stop="monitor('listen', r)"><Icon name="ear" /></button>
              <button :class="{ y: mode === 'whisper' && r.id === selected }" aria-label="Whisper" title="Whisper" :disabled="!r.onCall" @click.stop="monitor('whisper', r)"><Icon name="mic" /></button>
              <button :class="{ y: mode === 'barge' && r.id === selected }" aria-label="Barge in" title="Barge in" :disabled="!r.onCall" @click.stop="monitor('barge', r)"><Icon name="phone" /></button>
              <button aria-label="Send coaching prompt" title="Coach" @click.stop="selected = r.id; ($refs.coachInput as HTMLInputElement | undefined)?.focus()"><Icon name="send" /></button>
            </span>
          </div>
        </div>
        <div v-else class="scroll dv-table"><table class="rt"><thead><tr><th>Agent</th><th>Lang</th><th>State</th><th>Since</th><th class="act">Actions</th></tr></thead>
          <tbody><tr v-for="r in shown" :key="r.id" tabindex="0" :class="{ sel: r.id === selected }" @click="selected = r.id" @keydown.enter="selected = r.id">
            <td data-label="Agent">{{ r.name }}</td><td data-label="Lang">{{ r.langs.map((l) => l.toUpperCase()).join(' ') }}</td>
            <td data-label="State"><span class="pill" :class="r.tone">{{ r.state }}</span></td><td data-label="Since">{{ clock(r.since) }}</td>
            <td class="act"><div class="acs">
              <button aria-label="Listen" title="Listen" :disabled="!r.onCall" @click.stop="monitor('listen', r)"><Icon name="ear" /></button>
              <button aria-label="Whisper" title="Whisper" :disabled="!r.onCall" @click.stop="monitor('whisper', r)"><Icon name="mic" /></button>
              <button aria-label="Barge in" title="Barge in" :disabled="!r.onCall" @click.stop="monitor('barge', r)"><Icon name="phone" /></button></div></td></tr></tbody></table></div>
        <div v-if="!shown.length" class="ban" style="margin-top: 8px">{{ rows.length ? 'No agent matches. Clear the search or filters.' : 'No agents are signed in right now.' }}</div>

        <div v-if="mode && sel" class="ban" style="margin-top: 8px"><Icon name="ear" /><span>{{ NOTE[mode].replace('@', sel.name) }}</span></div>
        <div style="display: flex; gap: 6px; margin-top: 8px">
          <input ref="coachInput" v-model="prompt" aria-label="Coach prompt" :placeholder="`Coach prompt for ${sel ? firstName(sel.name) : 'an agent'}`" maxlength="300" @keydown.enter.prevent="sendPrompt" />
          <button class="y" aria-label="Send prompt" title="Send prompt" @click="sendPrompt"><Icon name="send" /></button></div>
        <div class="btns">
          <button :class="{ y: mode === 'listen' }" aria-label="Listen" title="Listen" @click="monitor('listen')"><Icon name="ear" /></button>
          <button :class="{ y: mode === 'whisper' }" aria-label="Whisper" title="Whisper" @click="monitor('whisper')"><Icon name="mic" /></button>
          <button :class="{ y: mode === 'barge' }" aria-label="Barge in" title="Barge in" @click="monitor('barge')"><Icon name="phone" /></button></div>
      </div>

      <div class="c s4 w2 stick">
        <div class="hd"><Icon name="alert" /><b>Alerts</b></div>
        <div v-for="a in wall.data.value.alerts" :key="a" class="row wl-alert"><Icon name="alert" /><span>{{ a }}</span></div>
        <div v-if="!wall.data.value.alerts.length" class="row"><span>Nothing needs attention</span><span class="pill ok">Clear</span></div>
        <div class="hd" style="margin-top: var(--sp-4)"><Icon name="globe" /><b>Agent languages</b></div>
        <Donut v-if="langSegments.length" :segments="langSegments" :center="String(langSegments.length)" sub="languages" />
        <EmptyState v-else compact icon="globe" title="No agents signed in" hint="Languages appear when agents go available." />
      </div>

      <div class="c s8 w2">
        <div class="hd"><Icon name="chart" /><b>Calls per hour, today</b></div>
        <BarChart :items="hourly" :height="150" trend label="Calls per hour today" />
      </div>
      <div class="c s4 w2">
        <div class="hd"><Icon name="note" /><b>Coaching log</b></div>
        <div v-for="(c, i) in coaching.data.value ?? []" :key="i" class="row"><span>{{ c.text }}</span><small>{{ shortDate(c.at) }}</small></div>
        <EmptyState v-if="coaching.data.value && !coaching.data.value.length" compact icon="note" title="No coaching yet" hint="Send a prompt or listen in on a call." />
      </div>
      <div v-if="wall.data.value.calls.length" class="c s12 w2">
        <div class="hd"><Icon name="phone" /><b>Calls in progress</b><span style="margin-left: auto"><ViewToggle :model-value="callsMode" @update:model-value="setCallsMode" /></span></div>
        <div class="scroll" :class="callsMode === 'cards' ? 'dv-cards' : 'dv-table'"><table class="rt"><thead><tr><th>Agent</th><th>Caller</th><th>Duration</th></tr></thead>
          <tbody><tr v-for="c in wall.data.value.calls" :key="c.id"><td data-label="Agent">{{ c.agentName }}</td><td data-label="Caller">{{ show(c.caller) }}</td><td data-label="Duration">{{ clock(c.seconds) }}</td></tr></tbody></table></div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.agc { cursor: pointer; }
.agc.sel { outline: 2px solid var(--yel); }
.agc .ft button { width: 34px; height: 34px; min-width: 0; padding: 0; }
.agc .ft button:disabled { opacity: 0.35; cursor: default; }
.wl-alert { align-items: center; gap: var(--sp-2); justify-content: flex-start; }
.wl-alert .i { flex: none; width: 16px; height: 16px; color: var(--warn-fg); }
</style>
