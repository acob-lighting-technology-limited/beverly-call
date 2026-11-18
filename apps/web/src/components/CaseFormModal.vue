<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CASE_SLA_MINUTES, type Assignee, type CaseCategory, type Customer, type SupportCase } from '@beverly-call/shared'
import Modal from '@/components/Modal.vue'
import { api } from '@/lib/api'
import { PRESENCE_LABEL } from '@/lib/case-people'
import { useSession } from '@/stores/session'
import { useToast } from '@/stores/toast'

/** Open an escalation case. From a customer profile the customer is fixed; from the Cases tab the agent finds one first. */
const props = defineProps<{ open: boolean; customer?: Customer | null; callId?: string }>()
const emit = defineEmits<{ close: []; created: [c: SupportCase] }>()
const toast = useToast()
const session = useSession()

const LABELS: Record<CaseCategory, string> = {
  token_not_received: 'Token not received', wallet_debited_no_token: 'Wallet debited, no token', meter_rejected_token: 'Meter rejected token',
  wrong_meter_credited: 'Wrong meter credited', hardware_fault: 'Hardware fault', meter_tamper: 'Meter tamper', billing_dispute: 'Billing dispute', other: 'Something else',
}
const PRIORITIES = [['CRITICAL', 'Critical'], ['HIGH', 'High'], ['MEDIUM', 'Medium'], ['LOW', 'Low']] as const

const q = ref('')
const found = ref<Customer[]>([])
const picked = ref<Customer | null>(null)
const category = ref<CaseCategory>('token_not_received')
const priority = ref<(typeof PRIORITIES)[number][0]>('MEDIUM')
const amount = ref<number | null>(null)
const notes = ref('')
const busy = ref(false)
const error = ref('')
/** Who gets the case: me, the queue, or a person. Admins run the desk but do not hold cases, so theirs starts in the queue. */
const isAdmin = computed(() => session.user?.role === 'admin')
const assignTo = ref<string>('me')
const people = ref<Assignee[]>([])
const others = computed(() => people.value.filter((p) => p.id !== session.user?.id))

watch(() => props.open, (o) => {
  if (!o) return
  picked.value = props.customer ?? null; q.value = ''; found.value = []; category.value = 'token_not_received'; priority.value = 'MEDIUM'; amount.value = null; notes.value = ''; error.value = ''
  assignTo.value = isAdmin.value ? 'queue' : 'me'
  void api<Assignee[]>('/cases/assignees').then((r) => { people.value = r }).catch(() => { people.value = [] })
})
let timer: ReturnType<typeof setTimeout> | undefined
function onSearch(): void {
  clearTimeout(timer)
  timer = setTimeout(async () => {
    if (q.value.trim().length < 2) { found.value = []; return }
    try { found.value = (await api<Customer[]>(`/customers?q=${encodeURIComponent(q.value.trim())}`)).slice(0, 6) } catch { found.value = [] }
  }, 250)
}
const hours = computed(() => Math.round(CASE_SLA_MINUTES[category.value] / 60 * 10) / 10)
const ready = computed(() => !!picked.value && !busy.value)
const chosen = computed(() => people.value.find((p) => p.id === assignTo.value) ?? null)
const hint = computed(() => assignTo.value === 'queue' ? 'It waits in the queue and the supervisors are told. The first agent or supervisor to take it starts it.' : assignTo.value === 'me' ? 'You keep it and start working on it now.' : `${chosen.value?.name ?? 'They'} is told straight away and starts it when ready. You can still follow it and add comments.`)

async function submit(): Promise<void> {
  if (!picked.value || busy.value) return
  busy.value = true; error.value = ''
  try {
    const c = await api<SupportCase>('/cases', { method: 'POST', body: JSON.stringify({
      category: category.value, priority: priority.value, customerRef: picked.value.id, customerPhone: picked.value.phone || undefined, meterNumber: picked.value.meter || undefined,
      callId: props.callId, amountNgn: amount.value ?? 0, notes: notes.value.trim() || undefined,
      // Left out when I keep it (the server's default); null puts it in the queue.
      ...(assignTo.value === 'me' ? {} : { assigneeId: assignTo.value === 'queue' ? null : assignTo.value }) }) })
    toast.show(c.agentId === null ? `${c.id} opened and waiting in the queue` : c.agentId === session.user?.id ? `${c.id} opened` : `${c.id} opened and given to ${c.by}`); emit('created', c); emit('close')
  } catch (e) { error.value = e instanceof Error ? e.message : 'Could not open the case' }
  finally { busy.value = false }
}
</script>

<template>
  <Modal :open="open" title="Open a case" @close="emit('close')">
    <template v-if="!picked">
      <label class="cf-l">Customer<input v-model="q" type="search" placeholder="Name, phone, meter number or account" data-autofocus @input="onSearch" /></label>
      <button v-for="c in found" :key="c.id" class="cf-r" @click="picked = c"><b>{{ c.name || 'Unnamed' }}</b><span>{{ c.meter || 'No meter' }} · {{ c.area || 'No station' }}</span></button>
    </template>
    <div v-else class="cf-c"><b>{{ picked.name }}</b><span>{{ picked.meter || 'No meter' }}<template v-if="picked.area"> · {{ picked.area }}</template></span><button v-if="!customer" @click="picked = null">Change</button></div>
    <label class="cf-l">What went wrong<select v-model="category"><option v-for="(l, k) in LABELS" :key="k" :value="k">{{ l }}</option></select></label>
    <div class="cf-two">
      <label class="cf-l">Priority<select v-model="priority"><option v-for="p in PRIORITIES" :key="p[0]" :value="p[0]">{{ p[1] }}</option></select></label>
      <label class="cf-l">Amount involved (NGN)<input v-model.number="amount" type="number" min="0" inputmode="numeric" placeholder="0" /></label>
    </div>
    <label class="cf-l">Notes<textarea v-model="notes" rows="3" maxlength="1000" placeholder="What the customer said, what you checked"></textarea></label>
    <label class="cf-l">Give it to
      <select v-model="assignTo" aria-describedby="cf-who">
        <option v-if="!isAdmin" value="me">Me</option>
        <option value="queue">The queue (anyone can take it)</option>
        <optgroup v-if="others.length" label="Agents and supervisors">
          <option v-for="p in others" :key="p.id" :value="p.id">{{ p.name }}{{ p.role === 'supervisor' ? ' (supervisor)' : '' }}, {{ PRESENCE_LABEL[p.presence] }}{{ p.openCases ? `, ${p.openCases} open` : '' }}</option>
        </optgroup>
      </select></label>
    <p id="cf-who" class="cf-h">{{ hint }}</p>
    <p class="cf-h">Due in about {{ hours }} hours. The customer gets a text when it is resolved.</p>
    <p v-if="error" class="cf-e" role="alert">{{ error }}</p>
    <template #footer><button @click="emit('close')">Cancel</button><button class="y" :disabled="!ready" @click="submit">{{ busy ? 'Opening…' : 'Open case' }}</button></template>
  </Modal>
</template>

<style>
.cf-l { display: grid; gap: 4px; margin-top: 10px; font-size: 13px; color: var(--mut); }
.cf-two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.cf-r { display: grid; justify-items: start; gap: 2px; width: 100%; text-align: left; margin-top: 6px; padding: 10px 12px; border-radius: 14px; background: var(--panel); }
.cf-r b { font-weight: 400; } .cf-r span { font-size: 12px; color: var(--mut); }
.cf-c { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin-top: 4px; padding: 10px 12px; border-radius: 14px; background: var(--panel); }
.cf-c b { font-weight: 400; flex: 1; } .cf-c span { font-size: 12px; color: var(--mut); } .cf-c button { min-width: 0; padding: 4px 10px; }
.cf-h { margin: 10px 0 0; font-size: 12px; color: var(--mut); } .cf-e { margin: 8px 0 0; color: #c0392b; font-size: 13px; }
</style>
