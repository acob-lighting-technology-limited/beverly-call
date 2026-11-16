<script setup lang="ts">
/** A customer's work on one panel: escalation cases (open and resolve) and the Beverly support tickets raised by or for them. Used by: the customer profile. */
import { computed, ref, watch } from 'vue'
import type { Customer, SupportCase, SupportTicket, SupportTicketDetail } from '@beverly-call/shared'
import Icon from '@/components/Icon.vue'
import CaseFormModal from '@/components/CaseFormModal.vue'
import SupportTicketModal from '@/components/SupportTicketModal.vue'
import { api } from '@/lib/api'
import { shortDate } from '@/lib/format'
import { humanStatus, supportPriorityTone, supportStatusTone } from '@/lib/status'
import { slaLabel } from '@/lib/sla'
import { useSession } from '@/stores/session'
import { useToast } from '@/stores/toast'

const props = defineProps<{ customer: Customer }>()
const emit = defineEmits<{ changed: [] }>()
const session = useSession()
const toast = useToast()

const cases = ref<SupportCase[]>([])
const tickets = ref<SupportTicket[]>([])
const loading = ref(true)
const error = ref('')
const formOpen = ref(false)
const openTicket = ref<string | null>(null)
const resolving = ref<string | null>(null)
const note = ref('')
const busy = ref(false)

async function load(): Promise<void> {
  loading.value = true; error.value = ''
  const id = encodeURIComponent(props.customer.id)
  const [c, t] = await Promise.allSettled([api<SupportCase[]>(`/customers/${id}/cases`), api<SupportTicket[]>(`/customers/${id}/support-tickets`)])
  cases.value = c.status === 'fulfilled' ? c.value : []
  tickets.value = t.status === 'fulfilled' ? t.value : []
  if (c.status === 'rejected' && t.status === 'rejected') error.value = 'Cases and tickets could not be loaded.'
  loading.value = false
}
watch(() => props.customer.id, load, { immediate: true })

const isLead = computed(() => session.role === 'supervisor' || session.role === 'admin')
const canResolve = (c: SupportCase): boolean => c.state !== 'Done' && (isLead.value || c.agentId === session.user?.id)
const openCases = computed(() => cases.value.filter((c) => c.state !== 'Done').length)
const openTickets = computed(() => tickets.value.filter((t) => t.status !== 'resolved' && t.status !== 'closed').length)
const caseTone: Record<string, string> = { Overdue: 'bad', Working: 'ye', New: 'vi', Done: 'ok' }

async function resolve(c: SupportCase): Promise<void> {
  if (!note.value.trim()) { toast.show('Add what fixed it first'); return }
  busy.value = true
  try {
    const u = await api<SupportCase>(`/cases/${c.id}/resolve`, { method: 'POST', body: JSON.stringify({ note: note.value.trim() }) })
    cases.value = cases.value.map((x) => (x.id === u.id ? u : x)); resolving.value = null; note.value = ''; toast.show(`${c.id} resolved`); emit('changed')
  } catch { toast.show('Could not resolve this case') } finally { busy.value = false }
}
function created(c: SupportCase): void { cases.value = [c, ...cases.value]; emit('changed') }
function ticketChanged(d: SupportTicketDetail): void { const { messages: _m, ...rest } = d; tickets.value = tickets.value.map((x) => (x.id === rest.id ? rest : x)) }
defineExpose({ reload: load })
</script>

<template>
  <div class="c fr cw">
    <div class="hd"><Icon name="flag" /><b>Cases</b><span class="pill" :class="openCases ? 'bad' : 'ok'">{{ openCases }} open</span><button class="cw-new" @click="formOpen = true">Open case</button></div>
    <p v-if="error" class="cw-m">{{ error }}</p>
    <p v-else-if="loading" class="cw-m">Loading…</p>
    <template v-else>
      <div v-for="c in cases" :key="c.id" class="cw-r">
        <div class="cw-l"><b>{{ c.id }}</b><span>{{ c.issue }}<template v-if="c.amount"> · NGN {{ c.amount.toLocaleString('en-US') }}</template></span><small>{{ c.by }}<template v-if="c.state !== 'Done'"> · {{ slaLabel(c.slaMinutes, false).text }}</template></small></div>
        <span class="pill" :class="caseTone[c.state]">{{ c.state }}</span>
        <button v-if="canResolve(c)" @click="resolving = resolving === c.id ? null : c.id">Resolve</button>
        <div v-if="resolving === c.id" class="cw-f"><textarea v-model="note" rows="2" maxlength="1000" placeholder="What fixed it?" aria-label="Resolution note"></textarea>
          <button class="y" :disabled="busy" @click="resolve(c)">Resolve and text customer</button></div>
      </div>
      <p v-if="!cases.length" class="cw-m">No cases for this customer.</p>
    </template>

    <div class="hd" style="margin-top: 14px"><Icon name="note" /><b>Support tickets</b><span class="pill" :class="openTickets ? 'ye' : 'ok'">{{ openTickets }} open</span></div>
    <button v-for="t in tickets" :key="t.id" class="cw-t" @click="openTicket = t.id">
      <span class="cw-l"><b>{{ t.reference }}</b><span>{{ t.subject }}</span><small>{{ shortDate(t.lastMessageAt) }}<template v-if="t.meterContext"> · meter {{ t.meterContext }}</template></small></span>
      <span class="pill" :class="supportPriorityTone(t.priority)">{{ humanStatus(t.priority) }}</span><span class="pill" :class="supportStatusTone(t.status)">{{ humanStatus(t.status) }}</span>
    </button>
    <p v-if="!loading && !tickets.length" class="cw-m">No Beverly support tickets for this customer.</p>

    <CaseFormModal :open="formOpen" :customer="customer" @close="formOpen = false" @created="created" />
    <SupportTicketModal :ticket-id="openTicket" @close="openTicket = null" @changed="ticketChanged" />
  </div>
</template>

<style>
.cw .hd { display: flex; align-items: center; gap: 8px; } .cw .hd b { flex: 1; font-weight: 400; }
.cw-new { min-width: 0; padding: 5px 12px; }
.cw-m { color: var(--mut); margin: 8px 0 0; }
.cw-r, .cw-t { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; padding: 9px 0; border-top: 1px dotted var(--line); }
.cw-t { width: 100%; text-align: left; background: none; border-radius: 0; height: auto; }
.cw-l { flex: 1; min-width: 0; display: grid; gap: 1px; } .cw-l b { font-weight: 500; font-size: 13px; } .cw-l small { color: var(--mut); font-size: 11px; }
.cw-f { flex-basis: 100%; display: grid; gap: 6px; }
</style>
