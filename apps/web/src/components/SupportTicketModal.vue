<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { SupportPriority, SupportStatus, SupportTicketDetail } from '@beverly-call/shared'
import Modal from '@/components/Modal.vue'
import { api } from '@/lib/api'
import { shortDate } from '@/lib/format'
import { humanStatus, supportPriorityTone, supportStatusTone } from '@/lib/status'
import { useSession } from '@/stores/session'
import { useToast } from '@/stores/toast'

/** One Beverly support ticket with its conversation. Replies, notes, status, priority and assignment all go through Beverly's admin API. */
const props = defineProps<{ ticketId: string | null }>()
const emit = defineEmits<{ close: []; changed: [t: SupportTicketDetail] }>()
const session = useSession()
const toast = useToast()

const STATUSES: SupportStatus[] = ['open', 'pending', 'awaiting_customer', 'resolved', 'closed']
const PRIORITIES: SupportPriority[] = ['low', 'normal', 'high', 'urgent']
const t = ref<SupportTicketDetail | null>(null)
const loading = ref(false)
const failed = ref(false)
const reply = ref('')
const internal = ref(false)
const busy = ref(false)
const end = ref<HTMLElement | null>(null)

watch(() => props.ticketId, async (id) => {
  t.value = null; failed.value = false; reply.value = ''; internal.value = false
  if (!id) return
  loading.value = true
  try { t.value = await api<SupportTicketDetail>(`/support/tickets/${id}`); await nextTick(); end.value?.scrollIntoView({ block: 'end' }) } catch { failed.value = true }
  finally { loading.value = false }
}, { immediate: true })

const mine = computed(() => !!t.value?.assignedTo && t.value.assignedTo === session.user?.id)
function apply(d: SupportTicketDetail): void { t.value = d; emit('changed', d) }
async function change(patch: Record<string, unknown>, done: string): Promise<void> {
  if (!t.value) return
  busy.value = true
  try { apply(await api<SupportTicketDetail>(`/support/tickets/${t.value.id}`, { method: 'PATCH', body: JSON.stringify(patch) })); toast.show(done) }
  catch { toast.show('Beverly did not accept that change') } finally { busy.value = false }
}
async function send(): Promise<void> {
  if (!t.value || !reply.value.trim()) return
  busy.value = true
  try {
    apply(await api<SupportTicketDetail>(`/support/tickets/${t.value.id}/messages`, { method: 'POST', body: JSON.stringify({ body: reply.value.trim(), internal: internal.value }) }))
    toast.show(internal.value ? 'Internal note added' : 'Reply sent to the customer'); reply.value = ''; internal.value = false
    await nextTick(); end.value?.scrollIntoView({ block: 'end' })
  } catch { toast.show('Could not send that message') } finally { busy.value = false }
}
</script>

<template>
  <Modal :open="!!ticketId" :title="t ? `${t.reference}: ${t.subject}` : 'Support ticket'" wide @close="emit('close')">
    <p v-if="loading" class="st-m">Opening the ticket…</p>
    <p v-else-if="failed" class="st-m">Could not open this ticket.</p>
    <template v-else-if="t">
      <div class="st-top">
        <span class="pill" :class="supportStatusTone(t.status)">{{ humanStatus(t.status) }}</span>
        <span class="pill" :class="supportPriorityTone(t.priority)">{{ humanStatus(t.priority) }}</span>
        <small>From {{ t.requesterName }}<template v-if="t.meterContext"> · meter {{ t.meterContext }}</template> · opened {{ shortDate(t.createdAt) }}</small>
      </div>
      <div class="st-ctl">
        <label>Status<select :value="t.status" :disabled="busy" @change="change({ status: ($event.target as HTMLSelectElement).value }, 'Status updated')"><option v-for="s in STATUSES" :key="s" :value="s">{{ humanStatus(s) }}</option></select></label>
        <label>Priority<select :value="t.priority" :disabled="busy" @change="change({ priority: ($event.target as HTMLSelectElement).value }, 'Priority updated')"><option v-for="p in PRIORITIES" :key="p" :value="p">{{ humanStatus(p) }}</option></select></label>
        <button :disabled="busy" @click="change(mine ? { unassign: true } : { assignToMe: true }, mine ? 'Unassigned' : 'Assigned to you')">{{ mine ? 'Unassign me' : 'Assign to me' }}</button>
        <button v-if="t.status !== 'resolved' && t.status !== 'closed'" class="y" :disabled="busy" @click="change({ status: 'resolved' }, 'Ticket resolved')">Resolve</button>
      </div>
      <div class="st-thread" aria-live="polite">
        <div v-for="m in t.messages" :key="m.id" class="st-msg" :class="{ them: m.senderType === 'customer', note: m.internal }">
          <b>{{ m.sender }}<em v-if="m.internal"> · internal note</em></b><span>{{ m.body }}</span><small>{{ shortDate(m.at) }}</small>
        </div>
        <p v-if="!t.messages.length" class="st-m">No messages yet.</p><div ref="end"></div>
      </div>
      <template v-if="t.status !== 'closed'">
        <textarea v-model="reply" rows="2" :placeholder="internal ? 'Internal note (the customer will not see it)' : 'Reply to the customer'" maxlength="4000" aria-label="Message"></textarea>
        <div class="st-send"><label><input v-model="internal" type="checkbox" /> Internal note</label><button class="y" :disabled="busy || !reply.trim()" @click="send">{{ internal ? 'Add note' : 'Send reply' }}</button></div>
      </template>
    </template>
  </Modal>
</template>

<style>
.st-m { color: var(--mut); margin: 8px 0; }
.st-top { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; } .st-top small { color: var(--mut); }
.st-ctl { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px; margin: 10px 0; } .st-ctl label { display: grid; gap: 2px; font-size: 12px; color: var(--mut); }
.st-thread { display: grid; gap: 8px; max-height: 38dvh; overflow: auto; padding: 4px 2px; margin-bottom: 8px; }
.st-msg { display: grid; gap: 2px; max-width: 86%; padding: 8px 12px; border-radius: 16px; background: var(--panel); justify-self: end; }
.st-msg.them { justify-self: start; background: color-mix(in srgb, var(--yel) 22%, transparent); }
.st-msg.note { background: transparent; border: 1px dashed color-mix(in srgb, var(--ink) 25%, transparent); }
.st-msg b { font-weight: 500; font-size: 12px; } .st-msg b em { font-style: normal; color: var(--mut); font-weight: 400; } .st-msg small { color: var(--mut); font-size: 10px; } .st-msg span { white-space: pre-wrap; }
.st-send { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; gap: 8px; } .st-send label { font-size: 13px; color: var(--mut); }
</style>
