<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Customer, CustomerDetail } from '@beverly-call/shared'
import Modal from '@/components/Modal.vue'
import { api } from '@/lib/api'
import { useToast } from '@/stores/toast'

/**
 * Bind a calling number to a customer's meter(s). The agent confirms details with the caller; a supervisor approves.
 * Many numbers can be bound to one customer, and one number to several meters of that customer.
 */
const props = defineProps<{ open: boolean; phone?: string; callId?: string; customer?: Customer | null }>()
const emit = defineEmits<{ close: []; done: [] }>()
const toast = useToast()

const phone = ref('')
const q = ref('')
const found = ref<Customer[]>([])
const picked = ref<Customer | null>(null)
const meters = ref<string[]>([])
const chosen = ref<string[]>([])
const label = ref('')
const checks = ref({ meter: false, name: false, lastPurchase: false, address: false })
const busy = ref(false)
const error = ref('')

watch(() => props.open, async (o) => {
  if (!o) return
  phone.value = props.phone ?? ''; q.value = ''; found.value = []; label.value = ''; error.value = ''
  checks.value = { meter: false, name: false, lastPurchase: false, address: false }
  if (props.customer) await pick(props.customer); else { picked.value = null; meters.value = []; chosen.value = [] }
})

let timer: ReturnType<typeof setTimeout> | undefined
function onSearch(): void {
  clearTimeout(timer)
  timer = setTimeout(async () => {
    if (q.value.trim().length < 2) { found.value = []; return }
    try { found.value = (await api<Customer[]>(`/customers?q=${encodeURIComponent(q.value.trim())}`)).slice(0, 8) } catch { found.value = [] }
  }, 250)
}
async function pick(c: Customer): Promise<void> {
  picked.value = c; found.value = []
  try { meters.value = (await api<CustomerDetail>(`/customers/${encodeURIComponent(c.id)}/detail`)).meters } catch { meters.value = c.meter ? [c.meter] : [] }
  chosen.value = meters.value.length === 1 ? [...meters.value] : []
}
const confirmed = computed(() => Object.values(checks.value).filter(Boolean).length)
const ready = computed(() => !!picked.value && chosen.value.length > 0 && confirmed.value >= 2 && phone.value.replace(/\D/g, '').length >= 10 && !busy.value)

async function submit(): Promise<void> {
  if (!ready.value || !picked.value) return
  busy.value = true; error.value = ''
  try {
    await api('/bindings', { method: 'POST', body: JSON.stringify({ phone: phone.value, customerId: picked.value.id, meters: chosen.value, label: label.value.trim() || undefined, callId: props.callId, checks: checks.value }) })
    toast.show('Sent for approval'); emit('done'); emit('close')
  } catch (e) { error.value = e instanceof Error ? e.message : 'Could not send the request' }
  finally { busy.value = false }
}
</script>

<template>
  <Modal :open="open" title="Bind this number to a customer" @close="emit('close')">
    <label class="bn-l">Phone number<input v-model="phone" inputmode="tel" aria-label="Phone number to bind" /></label>
    <template v-if="!picked">
      <label class="bn-l">Find the customer<input v-model="q" type="search" placeholder="Name, meter number, account or station" data-autofocus @input="onSearch" /></label>
      <button v-for="c in found" :key="c.id" class="bn-r" @click="pick(c)"><b>{{ c.name || 'Unnamed' }}</b><span>{{ c.meter || 'No meter' }} · {{ c.area || 'No station' }}<template v-if="c.accountNo"> · {{ c.accountNo }}</template></span></button>
    </template>
    <template v-else>
      <div class="bn-c"><b>{{ picked.name }}</b><span>{{ picked.area || 'No station' }}<template v-if="picked.tariff"> · {{ picked.tariff }}</template></span>
        <button v-if="!customer" class="bn-x" @click="picked = null">Change</button></div>
      <fieldset class="bn-f"><legend>Meters this number may call about</legend>
        <label v-for="m in meters" :key="m" class="bn-k"><input v-model="chosen" type="checkbox" :value="m" />{{ m }}</label>
        <span v-if="!meters.length" class="bn-h">No meters found for this customer.</span></fieldset>
      <fieldset class="bn-f"><legend>Confirmed with the caller (at least two)</legend>
        <label class="bn-k"><input v-model="checks.meter" type="checkbox" />Meter number</label>
        <label class="bn-k"><input v-model="checks.name" type="checkbox" />Full name</label>
        <label class="bn-k"><input v-model="checks.lastPurchase" type="checkbox" />Last purchase amount or date</label>
        <label class="bn-k"><input v-model="checks.address" type="checkbox" />Address</label></fieldset>
      <label class="bn-l">Who is this? (optional)<input v-model="label" maxlength="40" placeholder="Owner, spouse, tenant, caretaker" /></label>
    </template>
    <p v-if="error" class="bn-e" role="alert">{{ error }}</p>
    <template #footer><button @click="emit('close')">Cancel</button><button class="y" :disabled="!ready" @click="submit">{{ busy ? 'Sending…' : 'Send for approval' }}</button></template>
  </Modal>
</template>

<style>
.bn-l { display: grid; gap: 4px; margin-top: 10px; font-size: 13px; color: var(--mut); }
.bn-l input { font-size: 15px; }
.bn-r { display: grid; gap: 2px; width: 100%; text-align: left; margin-top: 6px; padding: 10px 12px; border-radius: 14px; background: var(--panel); }
.bn-r b { font-weight: 400; } .bn-r span, .bn-h { font-size: 12px; color: var(--mut); }
.bn-c { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin-top: 10px; padding: 10px 12px; border-radius: 14px; background: var(--panel); }
.bn-c b { font-weight: 400; flex: 1; } .bn-c span { font-size: 12px; color: var(--mut); } .bn-x { min-width: 0; padding: 4px 10px; }
.bn-f { margin: 12px 0 0; padding: 0; border: 0; display: grid; gap: 6px; } .bn-f legend { padding: 0; font-size: 13px; color: var(--mut); margin-bottom: 4px; }
.bn-k { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.bn-e { margin: 10px 0 0; color: var(--bad, #c0392b); font-size: 13px; }
</style>
