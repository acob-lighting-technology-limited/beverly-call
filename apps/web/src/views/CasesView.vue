<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { Assignee, CaseState, SupportCase } from '@beverly-call/shared'
import Icon from '@/components/Icon.vue'
import CaseFormModal from '@/components/CaseFormModal.vue'
import ViewToggle from '@/components/ViewToggle.vue'
import { useViewMode } from '@/lib/use-view-mode'
import PageHeader from '@/components/PageHeader.vue'
import Pill from '@/components/Pill.vue'
import KpiTile from '@/components/KpiTile.vue'
import EmptyState from '@/components/EmptyState.vue'
import StateBanner from '@/components/StateBanner.vue'
import FilterPopover, { type FilterGroup } from '@/components/FilterPopover.vue'
import { api } from '@/lib/api'
import { PRESENCE_DOT, PRESENCE_LABEL } from '@/lib/case-people'
import { useResource } from '@/lib/use-resource'
import { slaLabel } from '@/lib/sla'
import { pad2 } from '@/lib/format'
import { useSession } from '@/stores/session'
import { useToast } from '@/stores/toast'

type Filter = 'all' | 'mine' | 'queue' | 'over' | 'done'
const tone: Record<CaseState, string> = { Overdue: 'bad', Working: 'ye', New: 'vi', Done: 'ok' }
const session = useSession()
const route = useRoute()
const { mode: tableMode, set: setTableMode } = useViewMode('cases')
const toast = useToast()
const isLead = computed(() => session.role === 'supervisor' || session.role === 'admin')
const me = computed(() => session.user?.id ?? '')

// Supervisors see every case. Agents see what they hold or raised, plus the queue, so they can take work.
const res = useResource(async () => {
  if (isLead.value) return api<SupportCase[]>('/cases')
  const [mine, queue] = await Promise.all([api<SupportCase[]>('/cases/mine'), api<SupportCase[]>('/cases/queue')])
  const seen = new Set(mine.map((c) => c.id))
  return [...mine, ...queue.filter((c) => !seen.has(c.id))]
})
const people = useResource(() => api<Assignee[]>('/cases/assignees'))
const selId = ref<string | null>(null)
const filter = ref<Filter>('all')
const q = ref('')
const extra = ref<Record<string, string[]>>({})
const note = ref('')
const formOpen = ref(false)
const comment = ref('')
const resolving = ref(false)
const handing = ref(false)
const handTo = ref('')
const handNote = ref('')
const releasing = ref(false)
const releaseNote = ref('')
const busy = ref(false)

const cases = computed(() => res.data.value ?? [])
const isMine = (c: SupportCase): boolean => c.agentId === me.value || c.raisedById === me.value
const inQueue = (c: SupportCase): boolean => c.agentId === null && c.state !== 'Done'
const sel = computed(() => cases.value.find((c) => c.id === selId.value) ?? cases.value.find((c) => c.state !== 'Done') ?? null)
const open = computed(() => cases.value.filter((c) => c.state !== 'Done').length)
const overdue = computed(() => cases.value.filter((c) => c.state === 'Overdue').length)
const fixed = computed(() => cases.value.filter((c) => c.state === 'Done').length)
const queued = computed(() => cases.value.filter(inQueue).length)
const groups = computed<FilterGroup[]>(() => [{ key: 'issue', label: 'Issue', options: [...new Set(cases.value.map((c) => c.issue))] }, { key: 'state', label: 'State', options: ['New', 'Working', 'Overdue', 'Done'] }])
const visible = computed(() => cases.value.filter((c) =>
  (filter.value === 'all' || (filter.value === 'mine' && isMine(c)) || (filter.value === 'queue' && inQueue(c)) || (filter.value === 'over' && c.state === 'Overdue') || (filter.value === 'done' && c.state === 'Done')) &&
  (!q.value || `${c.id} ${c.issue} ${c.customer} ${c.by} ${c.raisedBy}`.toLowerCase().includes(q.value.toLowerCase())) &&
  (!extra.value.issue?.length || extra.value.issue.includes(c.issue)) && (!extra.value.state?.length || extra.value.state.includes(c.state))))
const FILTERS: [Filter, string][] = [['all', 'All'], ['mine', 'Mine'], ['queue', 'Queue'], ['over', 'Overdue'], ['done', 'Done']]
const ring = computed(() => {
  const c = sel.value
  if (!c) return { pct: 0, text: '' }
  if (c.state === 'Done') return { pct: 100, text: 'Done' }
  return { pct: c.slaMinutes < 0 ? 100 : Math.max(0, Math.min(100, (c.slaMinutes / 60) * 100)), text: c.slaMinutes < 0 ? `-${-c.slaMinutes}m` : `${c.slaMinutes}m` }
})
const slaView = computed(() => (sel.value ? slaLabel(sel.value.slaMinutes, sel.value.state === 'Done') : { text: '', tone: 'vi' }))
const initials = (name: string): string => name.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase() || '?'
/** Customer references can be long ids; show a short, copyable form and keep the full value on hover. */
const customerLabel = (c: string): string => (c.length > 18 ? `${c.slice(0, 8)}…` : c)

/* What the person looking at this case may do with it. The server decides again on every action; this only decides which buttons to show. */
const live = computed(() => !!sel.value && sel.value.state !== 'Done')
const holderIsMe = computed(() => sel.value?.agentId === me.value)
const canAccept = computed(() => live.value && holderIsMe.value && !sel.value!.accepted)
const canClaim = computed(() => live.value && sel.value!.agentId === null && session.role !== 'admin')
const canMove = computed(() => live.value && (isLead.value || holderIsMe.value))
const canRelease = computed(() => canMove.value && sel.value!.agentId !== null)
const canResolve = computed(() => live.value && (isLead.value || holderIsMe.value))
const canComment = computed(() => live.value && (isLead.value || holderIsMe.value || sel.value!.raisedById === me.value))
const candidates = computed(() => (people.data.value ?? []).filter((p) => p.id !== sel.value?.agentId))

/** Hand-overs, acknowledgements and comments as one feed, oldest first. */
const feed = computed(() => {
  const c = sel.value
  if (!c) return []
  return [
    ...c.events.map((e) => ({ kind: 'event' as const, by: e.by, text: e.text, at: e.at, ts: e.ts })),
    ...c.comments.map((m) => ({ kind: 'comment' as const, by: m.by, text: m.text, at: m.at, ts: m.ts })),
  ].sort((a, b) => a.ts.localeCompare(b.ts))
})

function patch(updated: SupportCase): void {
  const i = cases.value.findIndex((c) => c.id === updated.id)
  if (i > -1 && res.data.value) res.data.value[i] = updated
  else if (res.data.value) res.data.value = [updated, ...res.data.value]
}
function created(c: SupportCase): void { patch(c); selId.value = c.id; void people.reload() }
function resetForms(): void { resolving.value = false; handing.value = false; releasing.value = false; handTo.value = ''; handNote.value = ''; releaseNote.value = ''; note.value = ''; comment.value = '' }
watch(selId, resetForms)

/** One place for every action on the selected case. A refusal is shown in the server's own words, then the case is reloaded, because a refusal usually means someone else just changed it. */
async function act(path: string, body: unknown, done: string): Promise<boolean> {
  const c = sel.value
  if (!c || busy.value) return false
  busy.value = true
  try {
    patch(await api<SupportCase>(`/cases/${c.id}/${path}`, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }))
    toast.show(done); void people.reload()
    return true
  } catch (e) {
    toast.show(e instanceof Error ? e.message : 'That did not work')
    void res.reload()
    return false
  } finally { busy.value = false }
}
const accept = (): Promise<boolean> => act('accept', undefined, `You started ${sel.value?.id}`)
const claim = (): Promise<boolean> => act('claim', undefined, `You took ${sel.value?.id}`)
async function handOver(): Promise<void> {
  const who = candidates.value.find((p) => p.id === handTo.value)
  if (!who) return
  if (await act('assign', { agentId: who.id, note: handNote.value.trim() || undefined }, `${sel.value?.id} given to ${who.name}`)) { handing.value = false; handTo.value = ''; handNote.value = '' }
}
async function release(): Promise<void> {
  if (await act('release', { note: releaseNote.value.trim() || undefined }, `${sel.value?.id} is back in the queue`)) { releasing.value = false; releaseNote.value = '' }
}
async function addComment(): Promise<void> {
  if (!comment.value.trim()) return
  if (await act('comments', { text: comment.value.trim() }, 'Comment added')) comment.value = ''
}
async function resolve(): Promise<void> {
  if (!note.value.trim()) { toast.show('Add what fixed it first'); return }
  const id = sel.value?.id
  if (await act('resolve', { note: note.value.trim() }, `${id} resolved. The customer is told by SMS.`)) { note.value = ''; resolving.value = false }
}

/** A link from an alert (/cases?open=EX-2042) opens that case, even if it is not in the list that loaded. */
async function openFromLink(): Promise<void> {
  const ref = route.query.open
  if (typeof ref !== 'string' || !ref) return
  if (!cases.value.some((c) => c.id === ref)) {
    try { patch(await api<SupportCase>(`/cases/${encodeURIComponent(ref)}`)) } catch (e) { toast.show(e instanceof Error ? e.message : 'That case could not be opened'); return }
  }
  selId.value = ref
}
onMounted(async () => { await res.reload(); await openFromLink() })
watch(() => route.query.open, () => { void openFromLink() })
</script>

<template>
  <section>
    <PageHeader :title="isLead ? 'Escalations' : 'My cases'">
      <template #actions><button class="y cs-new" @click="formOpen = true"><Icon name="plus" />Open a case</button></template>
      <div v-hover-scroll class="kp"><KpiTile icon="flag" :value="pad2(open)" label="Open" :metric="isLead ? 'open_cases' : undefined" /><KpiTile icon="users" :value="pad2(queued)" label="In queue" /><KpiTile icon="clock" :value="pad2(overdue)" label="Overdue" dark :metric="isLead ? 'overdue_cases' : undefined" /><KpiTile icon="check" :value="pad2(fixed)" label="Fixed" /></div>
    </PageHeader>
    <StateBanner :loading="res.loading.value && !res.data.value" :error="res.error.value" what="cases" />
    <div v-if="res.data.value" class="bento">
      <div class="c s8 w2">
        <div class="dtb"><label class="sch"><Icon name="x-srch" /><input v-model="q" type="search" aria-label="Search cases" placeholder="Search cases" /></label>
          <span class="n" aria-live="polite">{{ visible.length }} results</span><FilterPopover v-model="extra" :groups="groups" /><ViewToggle :model-value="tableMode" @update:model-value="setTableMode" /></div>
        <div class="ss cs-tabs" role="group" aria-label="Show">
          <button v-for="f in FILTERS" :key="f[0]" :class="{ on: filter === f[0] }" @click="filter = f[0]">{{ f[1] }}<b v-if="f[0] === 'queue' && queued" class="cs-n">{{ queued }}</b></button></div>
        <div class="scroll" :class="tableMode === 'cards' ? 'dv-cards' : 'dv-table'"><table class="rt"><thead><tr><th>Case</th><th>Issue</th><th>Held by</th><th>SLA</th><th>State</th></tr></thead>
          <tbody>
            <tr v-for="c in visible" :key="c.id" tabindex="0" :class="{ sel: c.id === sel?.id }" @click="selId = c.id" @keydown.enter="selId = c.id">
              <td data-label="Case">{{ c.id }}</td><td data-label="Issue">{{ c.issue }}</td>
              <td data-label="Held by"><template v-if="c.agentId">{{ c.by }}</template><Pill v-else tone="vi">In queue</Pill></td>
              <td data-label="SLA"><Pill :tone="slaLabel(c.slaMinutes, c.state === 'Done').tone">{{ slaLabel(c.slaMinutes, c.state === 'Done').text }}</Pill></td>
              <td data-label="State"><Pill :tone="tone[c.state]">{{ c.state }}</Pill></td></tr>
          </tbody></table></div>
        <EmptyState v-if="!visible.length" icon="check" :title="cases.length ? (filter === 'queue' ? 'The queue is empty' : 'No cases match') : 'No escalations here'" :hint="cases.length ? (filter === 'queue' ? 'Every open case has someone on it.' : 'Clear the search or filters to see every case.') : 'Open a case when a customer needs wallet staff to step in.'" />
      </div>

      <div v-if="sel" class="c s4 w2 stick cp">
        <header class="cp-head">
          <div><small class="cp-ref">{{ sel.id }}</small><h2>{{ sel.issue }}</h2></div>
          <Pill :tone="tone[sel.state]">{{ sel.state }}</Pill>
        </header>
        <div class="cp-sla" :class="`sla-${slaView.tone}`" role="img" :aria-label="`Deadline: ${slaView.text}`">
          <b>{{ slaView.text }}</b>
          <span class="cp-bar"><i :style="{ width: `${ring.pct}%` }"></i></span>
        </div>
        <dl class="cp-facts">
          <div><dt>Customer</dt><dd :title="sel.customer"><code>{{ customerLabel(sel.customer) }}</code></dd></div>
          <div v-if="sel.amount"><dt>Amount</dt><dd>NGN {{ sel.amount.toLocaleString('en-US') }}</dd></div>
          <div><dt>Held by</dt><dd><template v-if="sel.agentId">{{ sel.by }}<small v-if="sel.state !== 'Done'" class="cp-st" :class="{ on: sel.accepted }">{{ sel.accepted ? 'working' : 'not started' }}</small></template><Pill v-else tone="vi">In queue</Pill></dd></div>
          <div><dt>Raised by</dt><dd>{{ sel.raisedBy || 'Unknown' }}</dd></div>
        </dl>

        <!-- What this person can do with the case -->
        <div v-if="canAccept || canClaim || canMove" class="cp-flow">
          <button v-if="canAccept" class="y cp-main" :disabled="busy" @click="accept"><Icon name="play" />Start working</button>
          <button v-if="canClaim" class="y cp-main" :disabled="busy" @click="claim"><Icon name="plus" />Take this case</button>
          <div v-if="canMove" class="cp-moves">
            <button v-if="!handing" :disabled="busy" @click="handing = true; releasing = false"><Icon name="users" />{{ sel.agentId ? 'Hand over' : 'Give to…' }}</button>
            <button v-if="canRelease && !releasing" :disabled="busy" @click="releasing = true; handing = false"><Icon name="lft" />Back to queue</button>
          </div>
          <form v-if="handing" class="cp-form" @submit.prevent="handOver">
            <label for="cp-hand">Give it to</label>
            <select id="cp-hand" v-model="handTo" required>
              <option value="" disabled>Choose an agent or supervisor</option>
              <option v-for="p in candidates" :key="p.id" :value="p.id">{{ p.name }}{{ p.role === 'supervisor' ? ' (supervisor)' : '' }}, {{ PRESENCE_LABEL[p.presence] }}{{ p.openCases ? `, ${p.openCases} open` : '' }}</option></select>
            <ul v-if="candidates.length" class="cp-who" aria-hidden="true"><li v-for="p in candidates.slice(0, 4)" :key="p.id" :class="{ pick: p.id === handTo }"><i :style="{ background: PRESENCE_DOT[p.presence] }"></i>{{ p.name.split(' ')[0] }}</li></ul>
            <input v-model="handNote" maxlength="500" placeholder="Why, or what they should know (optional)" aria-label="Note for the new holder" />
            <div class="cp-row"><button type="button" @click="handing = false">Cancel</button><button class="y" type="submit" :disabled="busy || !handTo">Hand over</button></div>
          </form>
          <form v-if="releasing" class="cp-form" @submit.prevent="release">
            <label for="cp-rel">Put it back in the queue</label>
            <input id="cp-rel" v-model="releaseNote" maxlength="500" placeholder="Why it needs someone else (optional)" />
            <div class="cp-row"><button type="button" @click="releasing = false">Cancel</button><button class="y" type="submit" :disabled="busy">Back to queue</button></div>
          </form>
        </div>

        <section class="cp-activity" aria-label="Activity">
          <h3>Activity</h3>
          <ol v-if="feed.length">
            <li v-for="(m, i) in feed" :key="i" :class="`cp-${m.kind}`">
              <span v-if="m.kind === 'comment'" class="cp-av" aria-hidden="true">{{ initials(m.by) }}</span><span v-else class="cp-dot" aria-hidden="true"></span>
              <div><template v-if="m.kind === 'comment'"><b>{{ m.by }}</b><small>{{ m.at }}</small><p>{{ m.text }}</p></template><template v-else><p>{{ m.text }}<small>{{ m.at }}</small></p></template></div>
            </li>
          </ol>
          <p v-else class="cp-none">Nothing has happened on this case yet.</p>
        </section>

        <div v-if="canComment || canResolve" class="cp-actions" :class="{ flat: handing || releasing }">
          <form v-if="canComment && !resolving" class="cp-compose" @submit.prevent="addComment">
            <input v-model="comment" aria-label="Comment" placeholder="Add a comment" maxlength="1000" />
            <button class="y" type="submit" aria-label="Add comment" :disabled="busy || !comment.trim()"><Icon name="send" /></button>
          </form>
          <template v-if="canResolve">
            <form v-if="resolving" class="cp-resolve" @submit.prevent="resolve">
              <label for="cp-note">What fixed it?</label>
              <textarea id="cp-note" v-model="note" rows="3" maxlength="1000" placeholder="The customer is told by SMS" required></textarea>
              <div class="cp-row"><button type="button" @click="resolving = false">Cancel</button><button class="y" type="submit" :disabled="busy || !note.trim()"><Icon name="check" />Resolve and text customer</button></div>
            </form>
            <button v-else class="cp-resolve-btn" @click="resolving = true"><Icon name="check" />Resolve this case</button>
          </template>
        </div>
        <p v-else-if="live" class="cp-none">{{ sel.agentId === null ? 'Nobody holds this case yet. Take it to work on it.' : 'Only the person holding this case, the person who raised it, or a supervisor can change it.' }}</p>
      </div>
    </div>
  <CaseFormModal :open="formOpen" @close="formOpen = false" @created="created" />
  </section>
</template>

<style scoped>
.cs-new { display: inline-flex; align-items: center; gap: var(--sp-2); padding: 0 var(--sp-4); }
.cs-tabs { max-width: 520px; }
.cs-n { margin-left: 6px; min-width: 18px; padding: 0 5px; border-radius: var(--r-pill); background: var(--ye); color: var(--yet); font-size: 11px; font-weight: var(--fw-regular); line-height: 18px; text-align: center; }
.cp { display: grid; gap: var(--sp-4); align-content: start; }
.cp-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--sp-3); }
.cp-ref { display: block; color: var(--text-muted); font-size: var(--fs-sm); font-variant-numeric: tabular-nums; }
.cp-head h2 { margin: 2px 0 0; font-size: var(--fs-xl); font-weight: var(--fw-regular); line-height: 1.15; text-wrap: balance; }
.cp-sla { display: grid; gap: 6px; }
.cp-sla b { font-weight: var(--fw-regular); font-variant-numeric: tabular-nums; }
.sla-ok b { color: var(--success-fg); } .sla-bad b { color: var(--danger-fg); } .sla-ye b { color: var(--warn-fg); }
.cp-bar { display: block; height: 6px; border-radius: var(--r-pill); background: color-mix(in srgb, var(--text) 10%, transparent); overflow: hidden; }
.cp-bar i { display: block; height: 100%; border-radius: var(--r-pill); background: var(--accent); transition: width var(--dur-slow) var(--ease); }
.sla-bad .cp-bar i { background: var(--danger); }
.cp-facts { margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-3); }
.cp-facts dt { color: var(--text-muted); font-size: var(--fs-sm); }
.cp-facts dd { margin: 2px 0 0; min-width: 0; overflow-wrap: anywhere; }
.cp-facts code { font-size: var(--fs-sm); }
.cp-st { display: block; color: var(--text-muted); font-size: var(--fs-xs); }
.cp-st.on { color: var(--success-fg); }
.cp-flow { display: grid; gap: var(--sp-2); }
.cp-main { display: inline-flex; align-items: center; justify-content: center; gap: var(--sp-2); width: 100%; }
.cp-moves { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
.cp-moves button { display: inline-flex; align-items: center; gap: var(--sp-2); padding: 0 var(--sp-3); }
.cp-form { display: grid; gap: var(--sp-2); padding: var(--sp-3); border-radius: var(--r-md); background: var(--panel); border: 1px solid var(--line); }
.cp-form label { color: var(--text-muted); font-size: var(--fs-sm); }
.cp-who { list-style: none; display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; font-size: var(--fs-xs); color: var(--text-muted); }
.cp-who li { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: var(--r-pill); border: 1px solid var(--line); }
.cp-who li.pick { color: var(--text); border-color: var(--accent); }
.cp-who i { width: 7px; height: 7px; border-radius: 50%; }
.cp-activity h3 { margin: 0 0 var(--sp-2); font-size: var(--fs-sm); font-weight: var(--fw-regular); color: var(--text-muted); }
.cp-activity ol { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sp-3); }
.cp-activity li { display: flex; gap: var(--sp-2); }
.cp-activity li > div { min-width: 0; }
.cp-activity small { margin-left: var(--sp-2); color: var(--text-muted); font-size: var(--fs-xs); }
.cp-activity p { margin: 2px 0 0; overflow-wrap: anywhere; }
.cp-event p { margin: 0; color: var(--text-muted); font-size: var(--fs-sm); }
.cp-dot { flex: none; width: 8px; height: 8px; margin: 6px 10px 0 10px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent); }
.cp-av { flex: none; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: color-mix(in srgb, var(--accent) 30%, transparent); font-size: var(--fs-xs); font-weight: var(--fw-medium); }
.cp-none { margin: 0; color: var(--text-muted); font-size: var(--fs-md); }
.cp-actions { position: sticky; bottom: 0; display: grid; gap: var(--sp-2); padding-top: var(--sp-3); background: linear-gradient(transparent, color-mix(in srgb, var(--surface) 92%, transparent) 24%); }
.cp-actions.flat { position: static; background: none; }
.cp-compose { display: flex; gap: var(--sp-2); }
.cp-resolve { display: grid; gap: var(--sp-2); }
.cp-resolve label { color: var(--text-muted); font-size: var(--fs-sm); }
.cp-row { display: flex; gap: var(--sp-2); justify-content: flex-end; }
.cp-row button, .cp-resolve-btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--sp-2); padding: 0 var(--sp-4); }
.cp-resolve-btn { width: 100%; background: color-mix(in srgb, var(--accent) 22%, transparent); }
</style>
