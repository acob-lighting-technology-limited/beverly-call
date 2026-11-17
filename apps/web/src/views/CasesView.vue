<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CaseState, PresenceRow, SupportCase } from '@beverly-call/shared'
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
import { useResource } from '@/lib/use-resource'
import { slaLabel } from '@/lib/sla'
import { pad2 } from '@/lib/format'
import { useSession } from '@/stores/session'
import { useToast } from '@/stores/toast'

type Filter = 'all' | 'mine' | 'over' | 'done'
const tone: Record<CaseState, string> = { Overdue: 'bad', Working: 'ye', New: 'vi', Done: 'ok' }
const session = useSession()
const { mode: tableMode, set: setTableMode } = useViewMode('cases')
const toast = useToast()
const isLead = computed(() => session.role === 'supervisor' || session.role === 'admin')

// Agents see the cases they hold; supervisors see all of them.
const res = useResource(() => api<SupportCase[]>(isLead.value ? '/cases' : '/cases/mine'))
const roster = useResource(async () => (isLead.value ? await api<PresenceRow[]>('/presence') : []))
const selId = ref<string | null>(null)
const filter = ref<Filter>('all')
const q = ref('')
const extra = ref<Record<string, string[]>>({})
const note = ref('')
const formOpen = ref(false)
function created(c: SupportCase): void { if (res.data.value) res.data.value = [c, ...res.data.value]; selId.value = c.id }
const comment = ref('')
const resolving = ref(false)
const busy = ref(false)

const cases = computed(() => res.data.value ?? [])
const sel = computed(() => cases.value.find((c) => c.id === selId.value) ?? cases.value.find((c) => c.state !== 'Done') ?? null)
const open = computed(() => cases.value.filter((c) => c.state !== 'Done').length)
const overdue = computed(() => cases.value.filter((c) => c.state === 'Overdue').length)
const fixed = computed(() => cases.value.filter((c) => c.state === 'Done').length)
const groups = computed<FilterGroup[]>(() => [{ key: 'issue', label: 'Issue', options: [...new Set(cases.value.map((c) => c.issue))] }, { key: 'state', label: 'State', options: ['New', 'Working', 'Overdue', 'Done'] }])
const visible = computed(() => cases.value.filter((c) =>
  (filter.value === 'all' || (filter.value === 'mine' && c.agentId === session.user?.id) || (filter.value === 'over' && c.state === 'Overdue') || (filter.value === 'done' && c.state === 'Done')) &&
  (!q.value || `${c.id} ${c.issue} ${c.customer} ${c.by}`.toLowerCase().includes(q.value.toLowerCase())) &&
  (!extra.value.issue?.length || extra.value.issue.includes(c.issue)) && (!extra.value.state?.length || extra.value.state.includes(c.state))))
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
const canAct = computed(() => !!sel.value && sel.value.state !== 'Done' && (isLead.value || sel.value.agentId === session.user?.id))

function patch(updated: SupportCase): void {
  const i = cases.value.findIndex((c) => c.id === updated.id)
  if (i > -1 && res.data.value) res.data.value[i] = updated
}
async function addComment(): Promise<void> {
  if (!sel.value || !comment.value.trim()) return
  busy.value = true
  try { patch(await api<SupportCase>(`/cases/${sel.value.id}/comments`, { method: 'POST', body: JSON.stringify({ text: comment.value.trim() }) })); comment.value = '' }
  catch { toast.show('Could not add the comment') } finally { busy.value = false }
}
async function resolve(): Promise<void> {
  if (!sel.value) return
  if (!note.value.trim()) { toast.show('Add what fixed it first'); return }
  busy.value = true
  try { patch(await api<SupportCase>(`/cases/${sel.value.id}/resolve`, { method: 'POST', body: JSON.stringify({ note: note.value.trim() }) })); note.value = ''; resolving.value = false; toast.show(`${sel.value.id} resolved. The customer is told by SMS.`) }
  catch { toast.show('Could not resolve this case') } finally { busy.value = false }
}
async function assign(agentId: string): Promise<void> {
  if (!sel.value || !agentId) return
  try { patch(await api<SupportCase>(`/cases/${sel.value.id}/assign`, { method: 'POST', body: JSON.stringify({ agentId }) })); toast.show('Case reassigned') }
  catch { toast.show('Could not reassign this case') }
}
</script>

<template>
  <section>
    <PageHeader :title="isLead ? 'Escalations' : 'My cases'">
      <template #actions><button class="y cs-new" @click="formOpen = true"><Icon name="plus" />Open a case</button></template>
      <div v-hover-scroll class="kp"><KpiTile icon="flag" :value="pad2(open)" label="Open" :metric="isLead ? 'open_cases' : undefined" /><KpiTile icon="clock" :value="pad2(overdue)" label="Overdue" dark :metric="isLead ? 'overdue_cases' : undefined" /><KpiTile icon="check" :value="pad2(fixed)" label="Fixed" /></div>
    </PageHeader>
    <StateBanner :loading="res.loading.value && !res.data.value" :error="res.error.value" what="cases" />
    <div v-if="res.data.value" class="bento">
      <div class="c s8 w2">
        <div class="dtb"><label class="sch"><Icon name="x-srch" /><input v-model="q" type="search" aria-label="Search cases" placeholder="Search cases" /></label>
          <span class="n" aria-live="polite">{{ visible.length }} results</span><FilterPopover v-model="extra" :groups="groups" /><ViewToggle :model-value="tableMode" @update:model-value="setTableMode" /></div>
        <div class="ss" style="max-width: 420px">
          <button v-for="f in (['all', 'mine', 'over', 'done'] as Filter[])" :key="f" :class="{ on: filter === f }" @click="filter = f">{{ { all: 'All', mine: 'Mine', over: 'Overdue', done: 'Done' }[f] }}</button></div>
        <div class="scroll" :class="tableMode === 'cards' ? 'dv-cards' : 'dv-table'"><table class="rt"><thead><tr><th>Case</th><th>Issue</th><th>By</th><th>SLA</th><th>State</th></tr></thead>
          <tbody>
            <tr v-for="c in visible" :key="c.id" tabindex="0" :class="{ sel: c.id === sel?.id }" @click="selId = c.id" @keydown.enter="selId = c.id">
              <td data-label="Case">{{ c.id }}</td><td data-label="Issue">{{ c.issue }}</td><td data-label="By">{{ c.by }}</td>
              <td data-label="SLA"><Pill :tone="slaLabel(c.slaMinutes, c.state === 'Done').tone">{{ slaLabel(c.slaMinutes, c.state === 'Done').text }}</Pill></td>
              <td data-label="State"><Pill :tone="tone[c.state]">{{ c.state }}</Pill></td></tr>
          </tbody></table></div>
        <EmptyState v-if="!visible.length" icon="check" :title="cases.length ? 'No cases match' : 'No escalations here'" :hint="cases.length ? 'Clear the search or filters to see every case.' : 'Open a case when a customer needs wallet staff to step in.'" />
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
          <div v-if="isLead && sel.state !== 'Done'" class="cp-wide"><dt><label for="cp-assign">Assigned to</label></dt>
            <dd><select id="cp-assign" :value="sel.agentId ?? ''" @change="assign(($event.target as HTMLSelectElement).value)"><option value="" disabled>Choose an agent</option>
              <option v-for="a in (roster.data.value ?? []).filter((x) => !x.admin)" :key="a.agentId" :value="a.agentId">{{ a.name }}</option></select></dd></div>
          <div v-else><dt>Held by</dt><dd>{{ sel.by }}</dd></div>
        </dl>

        <section class="cp-activity" aria-label="Activity">
          <h3>Activity</h3>
          <ol v-if="sel.comments.length">
            <li v-for="(m, i) in sel.comments" :key="i"><span class="cp-av" aria-hidden="true">{{ initials(m.by) }}</span><div><b>{{ m.by }}</b><small>{{ m.at }}</small><p>{{ m.text }}</p></div></li>
          </ol>
          <p v-else class="cp-none">No comments yet.</p>
        </section>

        <div v-if="canAct" class="cp-actions">
          <form v-if="!resolving" class="cp-compose" @submit.prevent="addComment">
            <input v-model="comment" aria-label="Comment" placeholder="Add a comment" maxlength="1000" />
            <button class="y" type="submit" aria-label="Add comment" :disabled="busy || !comment.trim()"><Icon name="send" /></button>
          </form>
          <form v-if="resolving" class="cp-resolve" @submit.prevent="resolve">
            <label for="cp-note">What fixed it?</label>
            <textarea id="cp-note" v-model="note" rows="3" maxlength="1000" placeholder="The customer is told by SMS" required></textarea>
            <div class="cp-row"><button type="button" @click="resolving = false">Cancel</button><button class="y" type="submit" :disabled="busy || !note.trim()"><Icon name="check" />Resolve and text customer</button></div>
          </form>
          <button v-else class="cp-resolve-btn" @click="resolving = true"><Icon name="check" />Resolve this case</button>
        </div>
        <p v-else-if="sel.state !== 'Done'" class="cp-none">Only the agent holding this case, or a supervisor, can change it.</p>
      </div>
    </div>
  <CaseFormModal :open="formOpen" @close="formOpen = false" @created="created" />
  </section>
</template>

<style scoped>
.cs-new { display: inline-flex; align-items: center; gap: var(--sp-2); padding: 0 var(--sp-4); }
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
.cp-wide { grid-column: 1 / -1; }
.cp-activity h3 { margin: 0 0 var(--sp-2); font-size: var(--fs-sm); font-weight: var(--fw-regular); color: var(--text-muted); }
.cp-activity ol { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sp-3); }
.cp-activity li { display: flex; gap: var(--sp-2); }
.cp-activity li > div { min-width: 0; }
.cp-activity small { margin-left: var(--sp-2); color: var(--text-muted); font-size: var(--fs-xs); }
.cp-activity p { margin: 2px 0 0; overflow-wrap: anywhere; }
.cp-av { flex: none; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: color-mix(in srgb, var(--accent) 30%, transparent); font-size: var(--fs-xs); font-weight: var(--fw-medium); }
.cp-none { margin: 0; color: var(--text-muted); font-size: var(--fs-md); }
.cp-actions { position: sticky; bottom: 0; display: grid; gap: var(--sp-2); padding-top: var(--sp-3); background: linear-gradient(transparent, color-mix(in srgb, var(--surface) 92%, transparent) 24%); }
.cp-compose { display: flex; gap: var(--sp-2); }
.cp-resolve { display: grid; gap: var(--sp-2); }
.cp-resolve label { color: var(--text-muted); font-size: var(--fs-sm); }
.cp-row { display: flex; gap: var(--sp-2); justify-content: flex-end; }
.cp-row button, .cp-resolve-btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--sp-2); padding: 0 var(--sp-4); }
.cp-resolve-btn { width: 100%; background: color-mix(in srgb, var(--accent) 22%, transparent); }
</style>
