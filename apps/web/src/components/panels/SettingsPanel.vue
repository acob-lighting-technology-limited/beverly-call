<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { INTERFACE_LOCALES } from '@beverly-call/shared'
import SidePanel from '@/components/SidePanel.vue'
import { disablePush, enablePush, installState, promptInstall, pushStatus, type PushStatus } from '@/lib/pwa'
import { useSession } from '@/stores/session'
import { useSettings } from '@/stores/settings'
import { useToast } from '@/stores/toast'
import { useUi } from '@/stores/ui'

const ui = useUi()
const s = useSettings()
const session = useSession()
const toast = useToast()
const push = ref<PushStatus>('off')
const pushNote = ref('')
const busy = ref(false)

const PALETTES = [{ id: '', n: 'Sunny', c: '#FCD95C' }, { id: 'brand', n: 'Brand', c: '#3BBC4A' }, { id: 'emerald', n: 'Emerald', c: '#00CA91' }, { id: 'lime', n: 'Lime', c: '#B3E635' }, { id: 'forest', n: 'Forest', c: '#4AA969' }]
const SOUND_KEY = 'bc.sounds'

const refreshPush = async (): Promise<void> => { push.value = await pushStatus(session.user?.id) }
onMounted(refreshPush)
watch(() => ui.panel, (p) => { if (p === 'settings') void refreshPush() })

const pushLocked = computed(() => push.value === 'unsupported' || push.value === 'needs-install' || push.value === 'blocked')
const pushHelp = computed(() => ({
  'needs-install': 'On iPhone and iPad, push alerts work once the app is installed: tap Share, then Add to Home Screen, and open it from there.',
  unsupported: 'This browser does not support push alerts.',
  blocked: 'Push alerts are blocked for this site. Allow notifications in your browser settings, then come back.',
  on: 'Alerts and incoming-call notifications reach this device even when Beverly Call is closed. Answering a call still happens inside the app.',
  off: 'Turn on to get alerts and incoming-call notifications even when Beverly Call is closed.',
} as Record<PushStatus, string>)[push.value])
const installHelp = computed(() => ({
  installed: 'Installed on this device. Open it from your home screen or app list.',
  ready: 'Install Beverly Call as an app on this device.',
  ios: 'On iPhone and iPad: tap Share, then Add to Home Screen.',
  manual: 'Use your browser menu: Install app, or Add to Home Screen.',
})[installState.value])

async function togglePush(on: boolean): Promise<void> {
  const id = session.user?.id
  if (!id || busy.value) return
  busy.value = true; pushNote.value = ''
  try {
    if (!on) await disablePush()
    else {
      const r = await enablePush(id, { mute: { ...s.p.mute }, sounds: s.p.sounds })
      if (r.ok) toast.show('Push alerts on'); else pushNote.value = r.reason
    }
  } finally { busy.value = false; await refreshPush() }
}
async function install(): Promise<void> {
  if ((await promptInstall()) === 'unavailable') toast.show(installHelp.value, 5000)
}
function setSounds(v: boolean): void { s.p.sounds = v; try { localStorage.setItem(SOUND_KEY, v ? '1' : '0') } catch { /* storage blocked */ } }
</script>

<template>
  <SidePanel :open="ui.panel === 'settings'" title="Settings" @close="ui.close">
    <h3>Appearance</h3>
    <div class="ss"><button v-for="t in (['light', 'dark', 'auto'] as const)" :key="t" :class="{ on: s.p.theme === t }" @click="s.p.theme = t">{{ t === 'auto' ? 'Auto night' : t[0]!.toUpperCase() + t.slice(1) }}</button></div>
    <div class="pks">
      <button v-for="p in PALETTES" :key="p.id" class="pk" :class="{ on: s.p.pal === p.id }" :aria-label="`Use the ${p.n} palette`" @click="s.p.pal = p.id">
        <span class="sw5"><i :style="{ background: p.c }"></i></span><b>{{ p.n }}</b></button>
    </div>
    <h3>Surface</h3>
    <div class="ss"><button :class="{ on: s.p.surface === 'frost' }" @click="s.p.surface = 'frost'">Frost</button><button :class="{ on: s.p.surface === 'glass' }" @click="s.p.surface = 'glass'">Liquid glass</button></div>
    <h3>Density</h3>
    <div class="ss"><button :class="{ on: !s.p.dense }" @click="s.p.dense = false">Comfortable</button><button :class="{ on: s.p.dense }" @click="s.p.dense = true">Compact</button></div>

    <h3>Accessibility</h3>
    <div class="sw"><span>Text size</span><input v-model.number="s.p.textSize" type="range" min="90" max="130" step="5" aria-label="Text size" style="width: 55%" /></div>
    <label class="sw"><span>High contrast</span><input v-model="s.p.highContrast" type="checkbox" /></label>
    <label class="sw"><span>Reduce motion</span><input v-model="s.p.reduceMotion" type="checkbox" /></label>

    <h3>Language</h3>
    <select v-model="s.p.lang" aria-label="Language"><option v-for="l in INTERFACE_LOCALES" :key="l.code" :value="l.code">{{ l.nativeLabel }}{{ l.nativeLabel === l.label ? '' : ` (${l.label})` }}</option></select>
    <p style="color: var(--mut); font-size: 12px; margin: 4px 0 0">Same languages as Beverly. Callers can still speak Pidgin: it is offered on the phone menu and used for routing.</p>

    <h3>Privacy and security</h3>
    <label class="sw"><span>Mask phone numbers</span><input v-model="s.p.mask" type="checkbox" /></label>
    <div class="sw"><span>Session timeout</span>
      <select v-model.number="s.p.sessionTimeoutMin" aria-label="Session timeout" style="width: 55%"><option :value="0">Off</option><option :value="5">5 minutes</option><option :value="15">15 minutes</option><option :value="30">30 minutes</option><option :value="60">1 hour</option><option :value="240">4 hours</option><option :value="480">8 hours</option></select></div>
    <div class="sw"><span>Set me Away when idle</span>
      <select v-model.number="s.p.autoAwayMin" aria-label="Set me Away when idle" style="width: 55%"><option :value="0">Never</option><option :value="5">After 5 minutes</option><option :value="10">After 10 minutes</option><option :value="15">After 15 minutes</option><option :value="30">After 30 minutes</option></select></div>

    <h3>Notifications</h3>
    <label class="sw"><span>Alert sounds</span><input :checked="s.p.sounds" type="checkbox" @change="setSounds(($event.target as HTMLInputElement).checked)" /></label>
    <label class="sw"><span>Escalation alerts</span><input :checked="!s.p.mute.esc" type="checkbox" @change="s.p.mute.esc = !($event.target as HTMLInputElement).checked" /></label>
    <label class="sw"><span>Callback alerts</span><input :checked="!s.p.mute.cb" type="checkbox" @change="s.p.mute.cb = !($event.target as HTMLInputElement).checked" /></label>
    <label class="sw"><span>System alerts</span><input :checked="!s.p.mute.sys" type="checkbox" @change="s.p.mute.sys = !($event.target as HTMLInputElement).checked" /></label>
    <label class="sw"><span>Push alerts on this device</span><input :checked="push === 'on'" :disabled="pushLocked || busy" type="checkbox" @change="togglePush(($event.target as HTMLInputElement).checked)" /></label>
    <p role="status" style="color: var(--mut); font-size: 12px; margin: 4px 0">{{ pushNote || pushHelp }}</p>

    <h3>App</h3>
    <p style="color: var(--mut); font-size: 12px; margin: 0 0 8px">{{ installHelp }}</p>
    <div v-if="installState !== 'installed'" class="btns"><button class="y" @click="install">Install app</button></div>
  </SidePanel>
</template>
