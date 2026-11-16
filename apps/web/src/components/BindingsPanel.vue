<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { PhoneBinding } from '@beverly-call/shared'
import { api } from '@/lib/api'
import { maskPhone } from '@/lib/mask'
import { shortDate } from '@/lib/format'
import { useSession } from '@/stores/session'
import { useToast } from '@/stores/toast'

/** Number-binding requests. Supervisors and admins decide; agents follow the status of their own requests. */
const session = useSession()
const toast = useToast()
const rows = ref<PhoneBinding[]>([])
const busy = ref('')
const canDecide = computed(() => session.role === 'supervisor' || session.role === 'admin')

async function load(): Promise<void> { try { rows.value = await api<PhoneBinding[]>('/bindings') } catch { rows.value = [] } }
async function decide(b: PhoneBinding, approve: boolean): Promise<void> {
  busy.value = b.id
  try { await api(`/bindings/${b.id}/decision`, { method: 'POST', body: JSON.stringify({ approve, note: approve ? undefined : 'Not verified' }) }); toast.show(approve ? 'Number bound' : 'Request rejected'); await load() }
  catch { toast.show('Could not record the decision') }
  finally { busy.value = '' }
}
const shown = computed(() => rows.value.filter((r) => r.status === 'pending' || r.createdAt > new Date(Date.now() - 7 * 864e5).toISOString()).slice(0, 30))
onMounted(load)
defineExpose({ load })
</script>

<template>
  <div v-if="shown.length" class="bp" aria-label="Number binding requests">
    <h2>Number binding</h2>
    <div v-for="b in shown" :key="b.id" class="bp-r">
      <div><b>{{ maskPhone(b.phone) }}</b> → {{ b.customerName || 'Customer' }} · {{ b.meter }}<template v-if="b.label"> · {{ b.label }}</template>
        <span class="bp-s">Requested by {{ b.requestedByName }} · {{ shortDate(b.createdAt) }}<template v-if="b.crmResult"> · CRM: {{ b.crmResult === 'primary' ? 'phone set' : 'added as extra number' }}</template></span></div>
      <template v-if="b.status === 'pending' && canDecide && b.requestedBy !== session.user?.id">
        <button :disabled="busy === b.id" @click="decide(b, false)">Reject</button><button class="y" :disabled="busy === b.id" @click="decide(b, true)">Approve</button>
      </template>
      <span v-else class="bp-t" :data-s="b.status">{{ b.status === 'applied' ? 'Bound' : b.status }}</span>
    </div>
  </div>
</template>

<style>
.bp { margin: 12px 0; padding: 12px 14px; border-radius: 18px; background: var(--card); }
.bp h2 { margin: 0 0 6px; font-size: 15px; font-weight: 400; }
.bp-r { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-top: 1px dotted var(--line); font-size: 14px; }
.bp-r > div { flex: 1; min-width: 0; } .bp-s { display: block; font-size: 12px; color: var(--mut); }
.bp-t { font-size: 12px; padding: 3px 10px; border-radius: 999px; background: var(--panel); text-transform: capitalize; }
</style>
