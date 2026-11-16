<script setup lang="ts">
import AgentProfileCard from '@/components/AgentProfileCard.vue'
import { shrinkImage } from '@/lib/photo'
import MyShifts from '@/components/MyShifts.vue'
import { computed, ref, watch } from 'vue'
import type { HandoverView } from '@beverly-call/shared'
import SidePanel from '@/components/SidePanel.vue'
import Icon from '@/components/Icon.vue'
import { api } from '@/lib/api'
import { shortDate } from '@/lib/format'
import { useSession } from '@/stores/session'
import { useToast } from '@/stores/toast'
import { useUi } from '@/stores/ui'

const ui = useUi()
const toast = useToast()
const session = useSession()

/* ---- Shift handover ---- */
const handover = ref<HandoverView['latest']>(null)
const note = ref('')
const saving = ref(false)
watch(() => ui.panel, async (p) => {
  if (p === 'handover') { try { handover.value = (await api<HandoverView>('/handover')).latest } catch { handover.value = null } }
  if (p === 'replies') await loadReplies()
})
async function saveHandover(): Promise<void> {
  if (!note.value.trim()) return
  saving.value = true
  try { await api('/handover', { method: 'POST', body: JSON.stringify({ body: note.value.trim() }) }); toast.show('Handover saved'); note.value = ''; ui.close() }
  catch { toast.show('Could not save the handover') }
  finally { saving.value = false }
}

/* ---- Saved replies ---- */
const replies = ref<string[]>([])
const rq = ref('')
const shown = computed(() => replies.value.filter((r) => r.toLowerCase().includes(rq.value.toLowerCase())))
async function loadReplies(): Promise<void> { try { replies.value = await api<string[]>('/replies') } catch { replies.value = [] } }
async function copy(t: string): Promise<void> { try { await navigator.clipboard.writeText(t); toast.show('Reply copied') } catch { toast.show('Copy is blocked in this browser') } }

/* ---- Shortcuts ---- */
const KEYS: [string, string][] = [['Mute', 'M'], ['Hold', 'H'], ['Keypad', 'K'], ['Transfer', 'T'], ['Notes', 'N'], ['Search', 'Ctrl K'], ['Shortcuts', '?'], ['Back', 'Alt Left'], ['Go to section', 'Alt 1 to 4']]

/* ---- Profile ---- */
const photoBusy = ref(false)
/** Uploads go through Beverly's own profile-picture flow, so the same photo shows in the wallet and the CRM. */
async function pick(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (!f) return
  photoBusy.value = true
  try {
    const img = await shrinkImage(f)
    await api('/agents/me/photo', { method: 'PUT', body: JSON.stringify(img) })
    const me = await api<{ photoVersion?: string | null }>('/session')
    session.setPhotoVersion(me.photoVersion ?? null)
    toast.show('Photo updated everywhere in Beverly')
  } catch (err) { toast.show(err instanceof Error && err.message && !err.message.startsWith('Request failed') ? err.message : 'Could not update the photo') }
  finally { photoBusy.value = false }
}
async function clearPhoto(): Promise<void> {
  photoBusy.value = true
  try { await api('/agents/me/photo', { method: 'DELETE' }); session.setPhotoVersion(null); toast.show('Photo removed everywhere in Beverly') }
  catch { toast.show('Could not remove the photo') } finally { photoBusy.value = false }
}
</script>

<template>
  <SidePanel :open="ui.panel === 'handover'" title="Shift handover" @close="ui.close">
    <div class="c"><div class="hd"><Icon name="note" /><b>From the last shift</b></div>
      <template v-if="handover">{{ handover.body }}<small style="display: block; color: var(--mut); margin-top: 6px">{{ handover.by }} · {{ shortDate(handover.at) }}</small></template>
      <span v-else style="color: var(--mut)">No handover note yet.</span></div>
    <textarea v-model="note" rows="4" aria-label="Handover note" placeholder="Notes for the next shift" maxlength="2000" style="margin-top: 10px"></textarea>
    <div class="btns"><button class="y" :disabled="saving || !note.trim()" aria-label="Save handover" @click="saveHandover"><Icon name="check" /></button></div>
  </SidePanel>

  <SidePanel :open="ui.panel === 'replies'" title="Help and replies" @close="ui.close">
    <input v-model="rq" type="search" aria-label="Search replies" placeholder="Search saved replies" />
    <div style="margin-top: 8px"><button v-for="r in shown" :key="r" class="mi" @click="copy(r)"><Icon name="copy" /><span>{{ r }}</span></button>
      <p v-if="!shown.length" style="color: var(--mut)">No reply matches.</p></div>
  </SidePanel>

  <SidePanel :open="ui.panel === 'shortcuts'" title="Shortcuts" @close="ui.close">
    <div class="c"><div v-for="[n, k] in KEYS" :key="n" class="row"><span>{{ n }}</span><b>{{ k }}</b></div></div>
  </SidePanel>

  <SidePanel :open="ui.panel === 'profile'" title="Profile" @close="ui.close">
    <AgentProfileCard v-if="ui.panel === 'profile' && session.user" :agent-id="session.user.id" :photo="session.photo">
      <template #actions>
        <div class="btns" style="justify-content: center">
          <label class="fbtn" style="cursor: pointer">{{ photoBusy ? 'Uploading…' : session.photo ? 'Change' : 'Add photo' }}<input type="file" accept="image/*" hidden :disabled="photoBusy" @change="pick" /></label>
          <button v-if="session.photo" :disabled="photoBusy" @click="clearPhoto">Remove</button></div>
      </template>
      <template #shift><MyShifts /></template>
    </AgentProfileCard>
    <p style="color: var(--mut); font-size: 12px">Your photo is your Beverly profile photo: the same picture shows in the wallet, the CRM and here. Your name, role and portal access come from Beverly.</p>
  </SidePanel>
</template>
