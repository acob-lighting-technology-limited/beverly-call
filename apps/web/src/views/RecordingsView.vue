<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Recording } from '@beverly-call/shared'
import Icon from '@/components/Icon.vue'
import ViewToggle from '@/components/ViewToggle.vue'
import { useViewMode } from '@/lib/use-view-mode'
import PageHeader from '@/components/PageHeader.vue'
import KpiTile from '@/components/KpiTile.vue'
import EmptyState from '@/components/EmptyState.vue'
import StateBanner from '@/components/StateBanner.vue'
import { api } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { clock, shortDate } from '@/lib/format'
import { maskPhone } from '@/lib/mask'
import { useSettings } from '@/stores/settings'
import { useToast } from '@/stores/toast'

const settings = useSettings()
const toast = useToast()
const { mode: tableMode, set: setTableMode } = useViewMode('recordings')
const recs = useResource(() => api<Recording[]>('/recordings'))
const q = ref('')
const playing = ref<{ rec: Recording; url: string } | null>(null)

const rows = computed(() => (recs.data.value ?? []).filter((r) => !q.value || `${r.caller} ${r.agentName ?? ''} ${r.agentId}`.toLowerCase().includes(q.value.toLowerCase())))
const held = computed(() => (recs.data.value ?? []).filter((r) => r.legalHold).length)
const show = (p: string) => (settings.p.mask ? maskPhone(p) : p)
/** Agent display name when Beverly knows it; otherwise a short id so the row is still identifiable. */
const agentLabel = (r: Recording): string => r.agentName || (r.agentId === 'Unassigned' ? 'Unassigned' : r.agentId.slice(0, 8))

async function play(r: Recording): Promise<void> {
  try { playing.value = { rec: r, url: (await api<{ url: string }>(`/recordings/${r.id}/url`)).url } }
  catch (e) {
    playing.value = null
    const m = e instanceof Error ? e.message : ''
    toast.show(m.includes('409') ? 'This recording is still being saved. Try again shortly.' : m.includes('503') ? 'Playback is unavailable right now.' : 'Could not open this recording.')
  }
}
async function hold(r: Recording): Promise<void> {
  try { await api(`/recordings/${r.id}/hold`, { method: 'POST', body: JSON.stringify({ hold: !r.legalHold }) }); toast.show(r.legalHold ? 'Legal hold released' : 'Held for legal review'); void recs.reload() }
  catch { toast.show('Could not change the hold') }
}
</script>

<template>
  <section>
    <PageHeader title="Recordings">
      <div v-if="recs.data.value" v-hover-scroll class="kp"><KpiTile icon="db" :value="recs.data.value.length" label="Recordings" /><KpiTile icon="lock" :value="held" label="Legal hold" dark /><KpiTile icon="clock" value="90d" label="Retention" /></div>
    </PageHeader>
    <StateBanner :loading="recs.loading.value && !recs.data.value" :error="recs.error.value" what="recordings" />
    <div v-if="recs.data.value" class="bento">
      <div class="c s7 w2">
        <div class="dtb"><label class="sch"><Icon name="x-srch" /><input v-model="q" type="search" aria-label="Search recordings" placeholder="Search by caller or agent" /></label><span class="n" aria-live="polite">{{ rows.length }} results</span><ViewToggle :model-value="tableMode" @update:model-value="setTableMode" /></div>
        <div v-if="rows.length" class="scroll" :class="tableMode === 'cards' ? 'dv-cards' : 'dv-table'"><table class="rt"><thead><tr><th>Date</th><th>Caller</th><th>Agent</th><th>Length</th><th>Expires</th><th class="act">Actions</th></tr></thead>
          <tbody>
            <tr v-for="r in rows" :key="r.id" :class="{ sel: r.id === playing?.rec.id }">
              <td data-label="Date">{{ shortDate(r.date) }}</td><td data-label="Caller">{{ show(r.caller) }}</td><td data-label="Agent">{{ agentLabel(r) }}</td><td data-label="Length">{{ clock(r.seconds) }}</td>
              <td data-label="Expires"><span v-if="r.legalHold" class="pill ye">Legal hold</span><template v-else-if="r.expiresAt">{{ shortDate(r.expiresAt) }}</template><template v-else>Kept forever</template></td>
              <td class="act"><div class="acs"><button :aria-label="`Play recording from ${show(r.caller)}`" title="Play" @click="play(r)"><Icon name="x-play" /></button>
                <button :aria-label="r.legalHold ? 'Release legal hold' : 'Hold for legal review'" :title="r.legalHold ? 'Release hold' : 'Hold for review'" @click="hold(r)"><Icon name="lock" /></button></div></td></tr>
          </tbody></table></div>
        <EmptyState v-else icon="mic" :title="q ? 'No recordings match' : 'No recordings yet'" :hint="q ? 'Try a different caller number or agent name.' : 'Calls are recorded automatically and appear here once they are saved.'" />
      </div>
      <div class="c s5 w2 stick">
        <div class="hd"><Icon name="play" /><b>Playback</b></div>
        <template v-if="playing">
          <div class="row"><span>Caller</span><b style="font-weight: 400">{{ show(playing.rec.caller) }}</b></div>
          <div class="row"><span>Agent</span><span>{{ agentLabel(playing.rec) }}</span></div>
          <div class="row"><span>Recorded</span><span>{{ shortDate(playing.rec.date) }}</span></div>
          <div class="row"><span>Length</span><span>{{ clock(playing.rec.seconds) }}</span></div>
          <audio :key="playing.rec.id" :src="playing.url" controls autoplay preload="none" class="rec-audio" :aria-label="`Recording from ${show(playing.rec.caller)}`"></audio>
          <p class="rec-note">Every play is logged. The play link is short-lived.</p></template>
        <EmptyState v-else compact icon="play" title="Choose a recording" hint="Press play on any row. Every play is logged." />
      </div>
    </div>
  </section>
</template>

<style scoped>
.rec-audio { width: 100%; margin-top: var(--sp-3); }
.rec-note { margin: var(--sp-2) 0 0; color: var(--text-muted); font-size: var(--fs-sm); }
</style>
