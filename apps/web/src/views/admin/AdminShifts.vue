<script setup lang="ts">
/** Shifts: the admin defines shift templates and rotations, puts agents on a rotation (staggered by an offset), and adjusts single days.
 *  Data: /admin/shifts/*, /shifts/roster, /admin/settings/shift_policy. Used by: AdminView. */
import { computed, ref } from 'vue'
import type { Roster, RosterCell, RosterRow, Rotation, RotationStep, ShiftTemplate } from '@beverly-call/shared'
import Icon from '@/components/Icon.vue'
import Modal from '@/components/Modal.vue'
import StateBanner from '@/components/StateBanner.vue'
import { api } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { useToast } from '@/stores/toast'

const toast = useToast()
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/* ---- week being viewed ---- */
const weekStart = ref('')
const roster = useResource(() => api<Roster>(`/shifts/roster${weekStart.value ? `?from=${weekStart.value}` : ''}`))
const templates = useResource(() => api<ShiftTemplate[]>('/admin/shifts/templates'))
const rotations = useResource(() => api<Rotation[]>('/admin/shifts/rotations'))
const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
function moveWeek(n: number): void { const base = roster.data.value?.from; if (!base) return; weekStart.value = addDays(base, n * 7); void roster.reload() }
const reloadAll = async (): Promise<void> => { await Promise.all([roster.reload(), templates.reload(), rotations.reload()]) }
const dayLabel = (d: string): string => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

async function call(fn: () => Promise<unknown>, ok: string): Promise<boolean> {
  try { await fn(); toast.show(ok); return true } catch (e) { toast.show(e instanceof Error && !e.message.startsWith('Request failed') ? e.message : 'That did not work'); return false }
}

/* ---- policy ---- */
const enforce = computed(() => roster.data.value?.policy.enforce ?? false)
const grace = ref(15)
async function savePolicy(on: boolean): Promise<void> {
  if (await call(() => api('/admin/settings/shift_policy', { method: 'PUT', body: JSON.stringify({ enforce: on, graceMinutes: grace.value }) }), on ? 'Calls now go only to agents on shift' : 'Calls go to any available agent')) await roster.reload()
}

/* ---- templates ---- */
const tForm = ref({ name: '', start: '06:00', end: '14:00', color: '#E3B93C' })
async function addTemplate(): Promise<void> {
  if (!tForm.value.name.trim()) { toast.show('Give the shift a name'); return }
  if (await call(() => api('/admin/shifts/templates', { method: 'POST', body: JSON.stringify({ ...tForm.value, name: tForm.value.name.trim() }) }), 'Shift added')) { tForm.value.name = ''; await reloadAll() }
}
async function removeTemplate(t: ShiftTemplate): Promise<void> { if (await call(() => api(`/admin/shifts/templates/${t.id}`, { method: 'DELETE' }), `${t.name} removed`)) await reloadAll() }

/* ---- rotation builder ---- */
const nextMonday = (): string => { const d = new Date(); const add = (8 - d.getUTCDay()) % 7 || 7; return addDays(d.toISOString().slice(0, 10), add) }
const rForm = ref<{ id: string | null; name: string; anchorDate: string; steps: RotationStep[] }>({ id: null, name: '', anchorDate: nextMonday(), steps: [{ shiftId: null, days: [0, 1, 2, 3, 4] }] })
const builderOpen = ref(false)
function newRotation(): void { rForm.value = { id: null, name: '', anchorDate: nextMonday(), steps: [{ shiftId: templates.data.value?.[0]?.id ?? null, days: [0, 1, 2, 3, 4] }] }; builderOpen.value = true }
function editRotation(r: Rotation): void { rForm.value = { id: r.id, name: r.name, anchorDate: r.anchorDate, steps: r.steps.map((s) => ({ shiftId: s.shiftId, days: [...s.days] })) }; builderOpen.value = true }
const toggleDay = (s: RotationStep, d: number): void => { s.days = s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d].sort() }
async function saveRotation(): Promise<void> {
  const f = rForm.value
  if (!f.name.trim()) { toast.show('Give the rotation a name'); return }
  const body = JSON.stringify({ name: f.name.trim(), anchorDate: f.anchorDate, steps: f.steps })
  const ok = f.id ? await call(() => api(`/admin/shifts/rotations/${f.id}`, { method: 'PUT', body }), 'Rotation saved. Agents on it were told.') : await call(() => api('/admin/shifts/rotations', { method: 'POST', body }), 'Rotation created')
  if (ok) { builderOpen.value = false; await reloadAll() }
}
async function removeRotation(r: Rotation): Promise<void> { if (await call(() => api(`/admin/shifts/rotations/${r.id}`, { method: 'DELETE' }), `${r.name} removed`)) await reloadAll() }
const tName = (id: string | null): string => (id ? templates.data.value?.find((t) => t.id === id)?.name ?? 'Missing shift' : 'Off')

/* ---- assignments ---- */
async function assign(row: RosterRow, rotationId: string, offset: number): Promise<void> {
  if (await call(() => api(`/admin/shifts/assignments/${encodeURIComponent(row.agentId)}`, { method: 'PUT', body: JSON.stringify({ rotationId: rotationId || null, offsetWeeks: offset }) }), rotationId ? `${row.name} is on the rotation` : `${row.name} is off rotation`)) await reloadAll()
}
const maxOffset = (rotationId: string | null): number => (rotations.data.value?.find((r) => r.id === rotationId)?.steps.length ?? 1)

/* ---- day overrides ---- */
const ov = ref<{ row: RosterRow; cell: RosterCell } | null>(null)
const ovShift = ref('')
const ovReason = ref('')
function openOverride(row: RosterRow, cell: RosterCell): void { ov.value = { row, cell }; ovShift.value = cell.shiftId ?? ''; ovReason.value = '' }
async function saveOverride(off: boolean): Promise<void> {
  if (!ov.value) return
  if (!off && !ovShift.value) { toast.show('Pick a shift or choose Day off'); return }
  const { row, cell } = ov.value
  if (await call(() => api('/admin/shifts/overrides', { method: 'PUT', body: JSON.stringify({ agentId: row.agentId, day: cell.day, shiftId: off ? null : ovShift.value, off, reason: ovReason.value.trim() || undefined }) }), `${row.name}: ${dayLabel(cell.day)} updated`)) { ov.value = null; await roster.reload() }
}
async function clearOverride(): Promise<void> {
  if (!ov.value) return
  const { row, cell } = ov.value
  if (await call(() => api(`/admin/shifts/overrides?agentId=${encodeURIComponent(row.agentId)}&day=${cell.day}`, { method: 'DELETE' }), 'Back to the rotation')) { ov.value = null; await roster.reload() }
}
const photo = (r: RosterRow): string => (r.hasPhoto ? `/api/agents/${encodeURIComponent(r.agentId)}/photo` : '')
const ini = (n: string): string => n.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase()
const cellLabel = (c: RosterCell): string => (c.name ? `${c.name} ${c.start}–${c.end}` : 'Off')
</script>

<template>
  <div class="bento">
    <div class="c s12 w1 sh-policy">
      <div class="hd"><Icon name="clock" /><b>Shift policy</b></div>
      <p class="sh-m">Off: any available agent gets a call. On: only agents who are on shift right now (Nigerian time) are offered calls, so the rotation decides who is reachable.</p>
      <div class="sh-row">
        <label class="sh-sw"><input type="checkbox" :checked="enforce" :disabled="!roster.data.value" @change="savePolicy(($event.target as HTMLInputElement).checked)" /> Only route calls to agents on shift</label>
        <label class="sh-f">Grace (minutes before and after)<input v-model.number="grace" type="number" min="0" max="120" @change="enforce && savePolicy(true)" /></label>
      </div>
    </div>

    <div class="c s5 w2">
      <div class="hd"><Icon name="clock" /><b>Shifts</b></div>
      <StateBanner :loading="templates.loading.value && !templates.data.value" :error="templates.error.value" what="shifts" />
      <div v-for="t in templates.data.value ?? []" :key="t.id" class="sh-t"><i :style="{ background: t.color }"></i><b>{{ t.name }}</b><span>{{ t.start }} to {{ t.end }}<em v-if="t.overnight"> · overnight</em></span><button aria-label="Remove shift" @click="removeTemplate(t)"><Icon name="x" /></button></div>
      <p v-if="templates.data.value && !templates.data.value.length" class="sh-m">No shifts yet. Add one below, for example Morning 06:00 to 14:00.</p>
      <div class="sh-add">
        <input v-model="tForm.name" placeholder="Name, e.g. Morning" maxlength="40" aria-label="Shift name" />
        <input v-model="tForm.start" type="time" aria-label="Start" /><input v-model="tForm.end" type="time" aria-label="End" /><input v-model="tForm.color" type="color" aria-label="Colour" />
        <button class="y" @click="addTemplate">Add shift</button>
      </div>
    </div>

    <div class="c s7 w2">
      <div class="hd"><Icon name="chart" /><b>Rotations</b><button class="sh-new" @click="newRotation">New rotation</button></div>
      <StateBanner :loading="rotations.loading.value && !rotations.data.value" :error="rotations.error.value" what="rotations" />
      <div v-for="r in rotations.data.value ?? []" :key="r.id" class="sh-r">
        <div class="sh-rh"><b>{{ r.name }}</b><span>{{ r.steps.length }} week{{ r.steps.length === 1 ? '' : 's' }} · starts {{ dayLabel(r.anchorDate) }} · {{ r.agents }} agent{{ r.agents === 1 ? '' : 's' }}</span>
          <button @click="editRotation(r)">Edit</button><button :disabled="r.agents > 0" :title="r.agents ? 'Move its agents first' : 'Delete'" @click="removeRotation(r)">Delete</button></div>
        <div class="sh-weeks"><span v-for="(s, i) in r.steps" :key="i" class="sh-w"><small>Week {{ i + 1 }}</small>{{ tName(s.shiftId) }}</span></div>
      </div>
      <p v-if="rotations.data.value && !rotations.data.value.length" class="sh-m">No rotations yet. A rotation lists the shift for each week of the cycle; agents move through it and wrap round.</p>
    </div>

    <div class="c s12 w3">
      <div class="hd"><Icon name="users" /><b>Roster</b>
        <span class="sh-nav"><button aria-label="Previous week" @click="moveWeek(-1)"><Icon name="lft" /></button>
          <b v-if="roster.data.value">{{ dayLabel(roster.data.value.days[0]!) }} to {{ dayLabel(roster.data.value.days[6]!) }}</b>
          <button aria-label="Next week" @click="moveWeek(1)"><Icon name="rgt" /></button></span></div>
      <StateBanner :loading="roster.loading.value && !roster.data.value" :error="roster.error.value" what="the roster" />
      <div v-if="roster.data.value" class="scroll"><table class="rt sh-grid"><thead><tr><th>Agent</th><th>Rotation</th><th v-for="(d, i) in roster.data.value.days" :key="d">{{ DAYS[i] }}<small>{{ dayLabel(d) }}</small></th></tr></thead>
        <tbody>
          <tr v-for="row in roster.data.value.rows" :key="row.agentId">
            <td><span class="sh-who"><span class="sh-av" :style="photo(row) ? { backgroundImage: `url(${photo(row)})` } : {}">{{ photo(row) ? '' : ini(row.name) }}<i :class="{ on: row.onShiftNow }" :title="row.onShiftNow ? 'On shift now' : 'Off shift'"></i></span><span><b>{{ row.name }}</b><small>{{ row.role ?? 'Staff' }}</small></span></span></td>
            <td class="sh-asg">
              <select :value="row.rotationId ?? ''" :aria-label="`Rotation for ${row.name}`" @change="assign(row, ($event.target as HTMLSelectElement).value, 0)"><option value="">None</option><option v-for="r in rotations.data.value ?? []" :key="r.id" :value="r.id">{{ r.name }}</option></select>
              <select v-if="row.rotationId" :value="row.offsetWeeks" :aria-label="`Week offset for ${row.name}`" @change="assign(row, row.rotationId, Number(($event.target as HTMLSelectElement).value))"><option v-for="n in maxOffset(row.rotationId)" :key="n" :value="n - 1">Starts week {{ n }}</option></select>
            </td>
            <td v-for="c in row.cells" :key="c.day"><button class="sh-c" :class="{ off: !c.name, ovr: c.source === 'override' }" :style="c.color ? { '--c': c.color } : {}" :title="cellLabel(c)" @click="openOverride(row, c)">
              <template v-if="c.name"><b>{{ c.name }}</b><small>{{ c.start }}–{{ c.end }}</small></template><template v-else>{{ c.source === 'none' ? '' : 'Off' }}</template></button></td>
          </tr>
          <tr v-if="!roster.data.value.rows.length"><td colspan="9" class="sh-m">No agents yet. They appear here once they have signed in or been put on a rotation.</td></tr>
        </tbody></table></div>
    </div>

    <Modal :open="builderOpen" :title="rForm.id ? 'Edit rotation' : 'New rotation'" wide @close="builderOpen = false">
      <label class="sh-f">Name<input v-model="rForm.name" maxlength="40" placeholder="e.g. Three-week rotation" data-autofocus /></label>
      <label class="sh-f">First week starts (a Monday)<input v-model="rForm.anchorDate" type="date" /></label>
      <div v-for="(s, i) in rForm.steps" :key="i" class="sh-step">
        <b>Week {{ i + 1 }}</b>
        <select v-model="s.shiftId" :aria-label="`Shift for week ${i + 1}`"><option :value="null">Off all week</option><option v-for="t in templates.data.value ?? []" :key="t.id" :value="t.id">{{ t.name }} ({{ t.start }}–{{ t.end }})</option></select>
        <span class="sh-days"><button v-for="(d, di) in DAYS" :key="d" type="button" :class="{ on: s.days.includes(di) }" :aria-pressed="s.days.includes(di)" @click="toggleDay(s, di)">{{ d }}</button></span>
        <button v-if="rForm.steps.length > 1" type="button" aria-label="Remove week" @click="rForm.steps.splice(i, 1)"><Icon name="x" /></button>
      </div>
      <button v-if="rForm.steps.length < 12" type="button" @click="rForm.steps.push({ shiftId: templates.data.value?.[0]?.id ?? null, days: [0, 1, 2, 3, 4] })">Add a week</button>
      <template #footer><button @click="builderOpen = false">Cancel</button><button class="y" @click="saveRotation">Save rotation</button></template>
    </Modal>

    <Modal :open="!!ov" :title="ov ? `${ov.row.name}, ${dayLabel(ov.cell.day)}` : ''" @close="ov = null">
      <template v-if="ov">
        <p class="sh-m">Now: {{ cellLabel(ov.cell) }}{{ ov.cell.source === 'override' ? ' (changed for this day)' : '' }}. A change here applies to this day only and tells the agent.</p>
        <label class="sh-f">Shift for this day<select v-model="ovShift"><option value="">Choose a shift</option><option v-for="t in templates.data.value ?? []" :key="t.id" :value="t.id">{{ t.name }} ({{ t.start }}–{{ t.end }})</option></select></label>
        <label class="sh-f">Reason (optional)<input v-model="ovReason" maxlength="200" placeholder="Swap, leave, training" /></label>
      </template>
      <template #footer><button v-if="ov?.cell.source === 'override'" @click="clearOverride">Back to rotation</button><button @click="saveOverride(true)">Day off</button><button class="y" @click="saveOverride(false)">Set shift</button></template>
    </Modal>
  </div>
</template>

<style scoped>
.sh-m { color: var(--mut); font-size: 12px; margin: 4px 0; }
.sh-row { display: flex; flex-wrap: wrap; align-items: end; gap: 12px 20px; }
.sh-sw { display: flex; align-items: center; gap: 8px; }
.sh-f { display: grid; gap: 3px; margin-top: 8px; font-size: 12px; color: var(--mut); }
.sh-t { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-top: 1px dotted var(--line); }
.sh-t i { width: 12px; height: 12px; border-radius: 4px; flex: none; } .sh-t b { font-weight: 500; } .sh-t span { flex: 1; color: var(--mut); font-size: 12px; } .sh-t em { font-style: normal; }
.sh-t button { min-width: 0; width: 28px; height: 28px; padding: 0; }
.sh-add { display: grid; grid-template-columns: 1fr 1fr 44px; gap: 6px; margin-top: 10px; } .sh-add input:first-child { grid-column: 1 / -1; } .sh-add input { width: 100%; min-width: 0; } .sh-add input[type=color] { padding: 2px; height: 100%; } .sh-add button { grid-column: 1 / -1; }
.sh-new { margin-left: auto; min-width: 0; padding: 5px 12px; }
.sh-r { padding: 8px 0; border-top: 1px dotted var(--line); }
.sh-rh { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; } .sh-rh b { font-weight: 500; } .sh-rh span { flex: 1; color: var(--mut); font-size: 12px; } .sh-rh button { min-width: 0; padding: 4px 10px; font-size: 12px; }
.sh-weeks { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; } .sh-w { display: grid; padding: 4px 10px; border-radius: 10px; background: var(--panel); font-size: 12px; } .sh-w small { color: var(--mut); font-size: 10px; }
.sh-nav { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; } .sh-nav button { min-width: 0; width: 30px; height: 30px; padding: 0; } .sh-nav b { font-weight: 400; font-size: 13px; }
.sh-grid th small { display: block; color: var(--mut); font-weight: 400; font-size: 10px; } .sh-grid td { vertical-align: middle; padding: 4px; }
.sh-who { display: flex; align-items: center; gap: 8px; min-width: 150px; } .sh-who b { display: block; font-weight: 500; font-size: 13px; } .sh-who small { color: var(--mut); font-size: 10px; }
.sh-av { position: relative; flex: none; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; background: var(--yel) center/cover; color: var(--on-accent); }
.sh-av i { position: absolute; right: -1px; bottom: -1px; width: 9px; height: 9px; border-radius: 50%; border: 2px solid var(--card); background: #9a9aa3; } .sh-av i.on { background: #3fae6a; }
.sh-asg { display: grid; gap: 4px; min-width: 130px; } .sh-asg select { font-size: 12px; padding: 4px 6px; }
.sh-c { --c: #9a9aa3; display: grid; gap: 0; width: 100%; min-width: 74px; height: auto; padding: 5px 6px; border-radius: 10px; text-align: left; background: color-mix(in srgb, var(--c) 24%, transparent); border: 1px solid color-mix(in srgb, var(--c) 55%, transparent); font-size: 12px; }
.sh-c b { font-weight: 500; font-size: 11px; } .sh-c small { color: var(--mut); font-size: 10px; } .sh-c.off { background: transparent; border-style: dashed; color: var(--mut); text-align: center; } .sh-c.ovr { outline: 2px solid var(--yel); outline-offset: -2px; }
.sh-step { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 8px 0; border-top: 1px dotted var(--line); } .sh-step > b { font-weight: 500; width: 58px; }
.sh-days { display: inline-flex; gap: 3px; } .sh-days button { min-width: 0; padding: 4px 7px; font-size: 11px; border-radius: 8px; background: var(--panel); } .sh-days button.on { background: var(--yel); color: var(--on-accent); }
</style>
