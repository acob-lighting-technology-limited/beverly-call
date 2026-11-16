<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AlertLimits, AuditRow, Connection, Outage, RetentionStatus, RoleSummary, StaffUser } from '@beverly-call/shared'
import Icon from '@/components/Icon.vue'
import PageHeader from '@/components/PageHeader.vue'
import StateBanner from '@/components/StateBanner.vue'
import { api } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import KpiTile from '@/components/KpiTile.vue'
import ViewToggle from '@/components/ViewToggle.vue'
import { useViewMode } from '@/lib/use-view-mode'
import { pad2, shortDate } from '@/lib/format'
import { useSession } from '@/stores/session'
import { useToast } from '@/stores/toast'

const session = useSession()
const { mode: staffMode, set: setStaffMode } = useViewMode('admin-staff')
const { mode: rolesMode, set: setRolesMode } = useViewMode('admin-roles')
const toast = useToast()
// Only a real admin can change settings; an admin previewing another view sees them read-only.
const canEdit = computed(() => session.user?.role === 'admin' && !session.viewAs)

const audit = useResource(() => api<AuditRow[]>('/audit'))
const retention = useResource(() => api<RetentionStatus>('/admin/retention'))
const connections = useResource(() => api<Connection[]>('/admin/connections'))
const users = useResource(() => api<StaffUser[]>('/admin/users'))
const roles = useResource(() => api<RoleSummary[]>('/admin/roles'))
const number = useResource(() => api<{ virtualNumber: string | null; retentionDays: number }>('/admin/number'))
const limitsRes = useResource(() => api<AlertLimits>('/admin/settings/alert_limits'))
const outagesRes = useResource(() => api<Outage[]>('/admin/settings/outages'))
const repliesRes = useResource(() => api<string[]>('/admin/settings/saved_replies'))

const limits = ref<AlertLimits | null>(null)
const outages = ref<Outage[]>([])
const replies = ref<string[]>([])
watch(() => limitsRes.data.value, (v) => { if (v) limits.value = { ...v } }, { immediate: true })
watch(() => outagesRes.data.value, (v) => { if (v) outages.value = v.map((o) => ({ ...o })) }, { immediate: true })
watch(() => repliesRes.data.value, (v) => { if (v) replies.value = [...v] }, { immediate: true })

async function save<T>(key: string, value: T, label: string): Promise<void> {
  try { await api(`/admin/settings/${key}`, { method: 'PUT', body: JSON.stringify(value) }); toast.show(`${label} saved`); void audit.reload() }
  catch { toast.show(`Could not save ${label.toLowerCase()}. Check the values.`) }
}
const addOutage = (): void => { outages.value.push({ area: '', message: '', until: '' }) }
const addReply = (): void => { replies.value.push('') }

const verifyMsg = ref('')
async function verify(): Promise<void> {
  try { const r = await api<{ checked: number; brokenAt: number | null }>('/admin/audit/verify'); verifyMsg.value = r.brokenAt === null ? `Chain intact: ${r.checked} entries checked.` : `Chain broken at entry ${r.brokenAt + 1}. Investigate now.` }
  catch { verifyMsg.value = 'Could not verify the chain.' }
}
interface LimitRow { key: keyof AlertLimits; label: string; hint: string; unit: string; min: number; max: number }
const LIMIT_ROWS: LimitRow[] = [
  { key: 'longestWaitSeconds', label: 'Longest wait', hint: 'Alert when a caller waits longer', unit: 's', min: 20, max: 180 },
  { key: 'abandonRatePct', label: 'Abandon rate', hint: 'Alert above this share of calls', unit: '%', min: 1, max: 15 },
  { key: 'creditDays', label: 'Credit left', hint: 'Warn when credit lasts fewer days', unit: 'd', min: 1, max: 14 },
]
/** Fill position of the slider track, 0 to 100%. */
const limitPct = (r: LimitRow): string => (limits.value ? `${((limits.value[r.key] - r.min) / (r.max - r.min)) * 100}%` : '0%')
const limitsDirty = computed(() => !!limits.value && !!limitsRes.data.value && JSON.stringify(limits.value) !== JSON.stringify(limitsRes.data.value))
async function saveLimits(): Promise<void> {
  if (!limits.value) return
  await save('alert_limits', limits.value, 'Alert limits')
  void limitsRes.reload()
}
function reloadAll(): void { void connections.reload(); void retention.reload() }

type Tab = 'overview' | 'desk' | 'people'
const TABS: { id: Tab; label: string }[] = [{ id: 'overview', label: 'Overview' }, { id: 'desk', label: 'Call desk' }, { id: 'people', label: 'People' }]
const tab = ref<Tab>('overview')
const connOk = computed(() => (connections.data.value ?? []).filter((c) => c.ok).length)
const connTotal = computed(() => (connections.data.value ?? []).length)
const activeStaff = computed(() => (users.data.value ?? []).filter((u) => u.active).length)
const needsAttention = computed(() => !!retention.data.value && (retention.data.value.pendingPurge > 0 || retention.data.value.lastFailed > 0))
const recentAudit = computed(() => (audit.data.value ?? []).slice(0, 8))
</script>

<template>
  <section>
    <PageHeader title="Admin">
      <div v-hover-scroll class="kp">
        <KpiTile icon="users" :value="pad2(activeStaff)" label="Active staff" />
        <KpiTile icon="db" :value="`${connOk}/${connTotal}`" label="Connections up" :dark="connOk < connTotal" />
        <KpiTile icon="lock" :value="`${retention.data.value?.retentionDays ?? 90}d`" label="Recording kept" />
      </div>
    </PageHeader>
    <div class="adm-tabs ss" role="tablist" aria-label="Admin sections">
      <button v-for="t in TABS" :id="`tab-${t.id}`" :key="t.id" role="tab" :aria-selected="tab === t.id" :aria-controls="`panel-${t.id}`" :class="{ on: tab === t.id }" @click="tab = t.id">{{ t.label }}</button>
    </div>
    <p v-if="!canEdit" class="ban" role="status">Read-only{{ session.viewAs ? ' while previewing another role' : '' }}.</p>

    <!-- Overview: health first, then what happened -->
    <div v-show="tab === 'overview'" id="panel-overview" role="tabpanel" aria-labelledby="tab-overview" class="bento">
      <div class="c dk s6"><div class="hd"><Icon name="db" /><b>Connections</b><button aria-label="Refresh connections" class="adm-ic" @click="reloadAll"><Icon name="auto" /></button></div>
        <StateBanner :loading="connections.loading.value" :error="connections.error.value" what="connections" />
        <div v-for="c in connections.data.value ?? []" :key="c.name" class="row"><span>{{ c.name }}<small class="adm-sub">{{ c.detail }}</small></span><span class="pill" :class="c.ok ? 'ok' : 'ye'">{{ c.ok ? 'Connected' : 'Check' }}</span></div></div>

      <div class="c s6"><div class="hd"><Icon name="lock" /><b>Retention proof</b>
        <span v-if="retention.data.value" class="pill" :class="needsAttention ? 'ye' : 'ok'">{{ needsAttention ? 'Needs attention' : 'On schedule' }}</span></div>
        <StateBanner :loading="retention.loading.value" :error="retention.error.value" what="retention status" />
        <template v-if="retention.data.value">
          <div class="row"><span>Last purge</span><span>{{ retention.data.value.lastRunAt ? shortDate(retention.data.value.lastRunAt) : 'Never run' }}</span></div>
          <div class="row"><span>Last run</span><span>{{ retention.data.value.lastDeleted }} deleted · {{ retention.data.value.lastHeld }} held · {{ retention.data.value.lastFailed }} failed</span></div>
          <div v-if="retention.data.value.pendingPurge" class="row"><span>Expired, waiting to purge</span><span>{{ retention.data.value.pendingPurge }}</span></div></template></div>

      <div class="c s12 w2"><div class="hd"><Icon name="db" /><b>Audit log</b><span class="pill ok">Tamper-evident</span>
        <button v-if="canEdit" class="adm-ic" aria-label="Verify audit chain" title="Verify the whole chain" @click="verify"><Icon name="check" /></button></div>
        <p v-if="verifyMsg" role="status" class="adm-note">{{ verifyMsg }}</p>
        <StateBanner :loading="audit.loading.value" :error="audit.error.value" what="the audit log" />
        <div v-for="a in recentAudit" :key="a.seq" class="row"><span>{{ a.action }}<small class="adm-sub">{{ a.actorRole }} · {{ a.entity }} {{ a.entityId.slice(0, 12) }}</small></span><small>{{ shortDate(a.at) }}</small></div>
        <p v-if="audit.data.value && !audit.data.value.length" class="adm-sub">No activity yet.</p></div>
    </div>

    <!-- Call desk: what an admin tunes for agents -->
    <div v-show="tab === 'desk'" id="panel-desk" role="tabpanel" aria-labelledby="tab-desk" class="bento">
      <div class="c s6 lim"><div class="hd"><Icon name="alert" /><b>Alert limits</b><span v-if="canEdit && limitsDirty" class="pill ye lim-flag">Unsaved</span></div>
        <StateBanner :loading="limitsRes.loading.value" :error="limitsRes.error.value" what="alert limits" />
        <template v-if="limits">
          <div v-for="r in LIMIT_ROWS" :key="r.key" class="lim-row">
            <label :for="`lim-${r.key}`">{{ r.label }}<small>{{ r.hint }}</small></label>
            <output class="lim-val" :for="`lim-${r.key}`">{{ limits[r.key] }}{{ r.unit }}</output>
            <input :id="`lim-${r.key}`" v-model.number="limits[r.key]" class="lim-range" type="range" :min="r.min" :max="r.max" :disabled="!canEdit" :aria-label="r.label" :style="{ '--pct': limitPct(r) }" />
          </div>
          <div v-if="canEdit" class="btns"><button class="y" aria-label="Save alert limits" :disabled="!limitsDirty" @click="saveLimits"><Icon name="check" />Save</button></div></template></div>

      <div class="c s6"><div class="hd"><Icon name="alert" /><b>Outages shown to agents</b></div>
        <div v-for="(o, i) in outages" :key="i" class="adm-outage">
          <input v-model="o.area" placeholder="Area" aria-label="Outage area" :disabled="!canEdit" maxlength="80" /><input v-model="o.message" placeholder="Message" aria-label="Outage message" :disabled="!canEdit" maxlength="200" />
          <input v-model="o.until" placeholder="Until" aria-label="Back by" :disabled="!canEdit" maxlength="40" /><button v-if="canEdit" :aria-label="`Remove outage ${i + 1}`" @click="outages.splice(i, 1)"><Icon name="x" /></button></div>
        <p v-if="!outages.length" class="adm-sub">No active outages.</p>
        <div v-if="canEdit" class="btns"><button aria-label="Add outage" @click="addOutage"><Icon name="plus" /></button><button class="y" aria-label="Save outages" @click="save('outages', outages.filter((o) => o.area && o.message), 'Outages')"><Icon name="check" /></button></div></div>

      <div class="c s6"><div class="hd"><Icon name="note" /><b>Saved replies</b></div>
        <div v-for="(_, i) in replies" :key="i" class="adm-reply"><input v-model="replies[i]" :aria-label="`Reply ${i + 1}`" :disabled="!canEdit" maxlength="300" /><button v-if="canEdit" :aria-label="`Remove reply ${i + 1}`" @click="replies.splice(i, 1)"><Icon name="x" /></button></div>
        <div v-if="canEdit" class="btns"><button aria-label="Add reply" @click="addReply"><Icon name="plus" /></button><button class="y" aria-label="Save replies" @click="save('saved_replies', replies.filter(Boolean), 'Saved replies')"><Icon name="check" /></button></div></div>

      <div class="c s6"><div class="hd"><Icon name="phone" /><b>Phone line</b></div>
        <div class="row"><span>Virtual number</span><span>{{ number.data.value?.virtualNumber ?? 'Not set' }}</span></div></div>
    </div>

    <!-- People: who can use the desk -->
    <div v-show="tab === 'people'" id="panel-people" role="tabpanel" aria-labelledby="tab-people" class="bento">
      <div class="c s7 w2"><div class="hd"><Icon name="users" /><b>Staff with call access</b></div>
        <StateBanner :loading="users.loading.value" :error="users.error.value" what="staff" />
        <div class="vt-row"><ViewToggle :model-value="staffMode" @update:model-value="setStaffMode" /></div>
        <div class="scroll" :class="staffMode === 'cards' ? 'dv-cards' : 'dv-table'"><table class="rt"><thead><tr><th>Name</th><th>Role</th><th>Active</th><th>Last login</th></tr></thead>
          <tbody><tr v-for="u in users.data.value ?? []" :key="u.id"><td data-label="Name">{{ u.name }}</td><td data-label="Role">{{ u.roleLabel ?? u.role.replace('custom-call-centre-', '') }}</td><td data-label="Active"><span class="pill" :class="u.active ? 'ok' : 'vi'">{{ u.active ? 'Active' : 'Off' }}</span></td><td data-label="Last login">{{ u.lastLogin ? shortDate(u.lastLogin) : 'Never' }}</td></tr></tbody></table></div>
        <p class="adm-sub">Managed in Beverly Wallet Admin.</p></div>

      <div class="c s5 w2"><div class="hd"><Icon name="lock" /><b>Beverly roles</b></div>
        <StateBanner :loading="roles.loading.value" :error="roles.error.value" what="roles" />
        <div class="vt-row"><ViewToggle :model-value="rolesMode" @update:model-value="setRolesMode" /></div>
        <div class="scroll" :class="rolesMode === 'cards' ? 'dv-cards' : 'dv-table'"><table class="rt"><thead><tr><th>Role</th><th>People</th><th>Permissions</th></tr></thead>
          <tbody><tr v-for="r in roles.data.value ?? []" :key="r.roleKey"><td data-label="Role">{{ r.label }}</td><td data-label="People">{{ r.people }}</td><td data-label="Permissions">{{ r.permissions }}</td></tr></tbody></table></div></div>
    </div>
  </section>
</template>

<style scoped>
.lim-flag { margin-left: auto; }
.lim .btns button { display: inline-flex; align-items: center; gap: var(--sp-2); padding: 0 var(--sp-4); }
.lim .btns button:disabled { opacity: .45; cursor: default; }
.lim-row { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 0 var(--sp-3); padding: var(--sp-2) 0 var(--sp-1); }
.lim-row label { display: grid; gap: 1px; font-weight: var(--fw-regular); }
.lim-row label small { color: var(--text-muted); font-size: var(--fs-xs); font-weight: var(--fw-light); }
.lim-val { min-width: 52px; text-align: center; padding: 3px 10px; border-radius: var(--r-pill); background: color-mix(in srgb, var(--accent) 24%, transparent); font-weight: var(--fw-medium); font-variant-numeric: tabular-nums; }
.lim-range { grid-column: 1 / -1; width: 100%; height: 22px; margin: var(--sp-1) 0 0; padding: 0; border: 0; background: transparent; -webkit-appearance: none; appearance: none; cursor: pointer; }
.lim-range:disabled { opacity: .55; cursor: default; }
.lim-range::-webkit-slider-runnable-track { height: 6px; border-radius: var(--r-pill); background: linear-gradient(90deg, var(--accent) var(--pct), color-mix(in srgb, var(--text) 14%, transparent) var(--pct)); }
.lim-range::-webkit-slider-thumb { -webkit-appearance: none; width: 20px; height: 20px; margin-top: -7px; border-radius: 50%; background: #fff; border: 1px solid color-mix(in srgb, var(--text) 18%, transparent); box-shadow: var(--sh-2); transition: transform var(--dur-fast) var(--ease-spring); }
.lim-range:active::-webkit-slider-thumb { transform: scale(1.12); }
.lim-range::-moz-range-track { height: 6px; border-radius: var(--r-pill); background: color-mix(in srgb, var(--text) 14%, transparent); }
.lim-range::-moz-range-progress { height: 6px; border-radius: var(--r-pill); background: var(--accent); }
.lim-range::-moz-range-thumb { width: 18px; height: 18px; border-radius: 50%; background: #fff; border: 1px solid color-mix(in srgb, var(--text) 18%, transparent); box-shadow: var(--sh-2); }
.lim-range:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-offset); border-radius: var(--r-pill); }
.adm-tabs { max-width: 420px; margin: 0 0 var(--sp-3); }
.adm-ic { margin-left: auto; height: 30px; min-width: 30px; padding: 0 8px; }
.adm-sub { display: block; color: var(--text-muted); font-size: var(--fs-sm); margin: var(--sp-1) 0 0; }
.adm-note { margin: 2px 0 var(--sp-2); }
.adm-outage { display: grid; grid-template-columns: 1fr 1.6fr 80px auto; gap: 6px; margin-bottom: 6px; }
.adm-reply { display: flex; gap: 6px; margin-bottom: 6px; }
.c.dk .adm-sub { color: color-mix(in srgb, var(--text-inverse) 70%, transparent); }
@media (max-width: 639px) { .adm-outage { grid-template-columns: 1fr 1fr; } .adm-outage input:nth-child(2) { grid-column: 1 / -1; } }
</style>
