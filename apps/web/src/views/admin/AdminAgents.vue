<script setup lang="ts">
/** Agent performance: who is online and how they are doing. Data: /presence, /reports/extras. Used by: AdminView. */
import { computed, ref, watch } from 'vue'
import { LANGUAGE_NAMES, type PresenceRow, type ReportExtras, type ReportRange } from '@beverly-call/shared'
import Icon from '@/components/Icon.vue'
import StateBanner from '@/components/StateBanner.vue'
import BarList from '@/components/charts/BarList.vue'
import ViewToggle from '@/components/ViewToggle.vue'
import Modal from '@/components/Modal.vue'
import AgentProfileCard from '@/components/AgentProfileCard.vue'
import { api } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { useViewMode } from '@/lib/use-view-mode'
import { clock } from '@/lib/format'

const range = ref<ReportRange>('7')
const opened = ref<PresenceRow | null>(null)
const presence = useResource(() => api<PresenceRow[]>('/presence'))
const extras = useResource(() => api<ReportExtras>(`/reports/extras?range=${range.value}`))
watch(range, () => void extras.reload())
const { mode, set } = useViewMode('admin-agents')

const STATUS_LABEL: Record<string, string> = { available: 'Available', busy: 'On a call', acw: 'Wrap-up', break: 'Break', away: 'Away' }
const STATUS_TONE: Record<string, string> = { available: 'ok', busy: 'vi', acw: 'vi', break: 'ye', away: 'bad' }
const rows = computed(() => [...(presence.data.value ?? [])].sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)))
const board = computed(() => (extras.data.value?.leaderboard ?? []).map((l) => ({ label: l.name, value: l.calls, sub: l.avgRating === null ? 'No ratings yet' : `Rated ${l.avgRating} of 5` })))
const RANGES: { id: ReportRange; label: string }[] = [{ id: '1', label: 'Today' }, { id: '7', label: '7 days' }, { id: '30', label: '30 days' }]
</script>

<template>
  <div class="bento">
    <div class="c s5 w2">
      <div class="hd"><Icon name="chart" /><b>Calls handled</b></div>
      <div class="ss ag-range" role="group" aria-label="Range"><button v-for="r in RANGES" :key="r.id" :class="{ on: range === r.id }" @click="range = r.id">{{ r.label }}</button></div>
      <StateBanner :loading="extras.loading.value && !extras.data.value" :error="extras.error.value" what="the leaderboard" />
      <BarList v-if="board.length" :rows="board" />
      <p v-else-if="extras.data.value" class="ag-empty">No calls handled in this period.</p>
    </div>

    <div class="c s7 w2">
      <div class="hd"><Icon name="users" /><b>Team right now</b></div>
      <StateBanner :loading="presence.loading.value && !presence.data.value" :error="presence.error.value" what="the team" />
      <div class="vt-row"><ViewToggle :model-value="mode" @update:model-value="set" /></div>
      <div class="scroll" :class="mode === 'cards' ? 'dv-cards' : 'dv-table'"><table class="rt"><thead><tr><th>Agent</th><th>Status</th><th>Languages</th><th>Time in status</th></tr></thead>
        <tbody>
          <tr v-for="p in rows" :key="p.agentId" tabindex="0" style="cursor: pointer" @click="opened = p" @keydown.enter="opened = p">
            <td data-label="Agent"><b style="font-weight: 400">{{ p.name }}</b><small style="display: block; color: var(--mut)">View profile and analytics</small></td>
            <td data-label="Status"><span class="pill" :class="p.online ? STATUS_TONE[p.status] : 'vi'">{{ p.online ? STATUS_LABEL[p.status] : 'Offline' }}</span></td>
            <td data-label="Languages">{{ p.languages.map((l) => LANGUAGE_NAMES[l] ?? l).join(', ') || '—' }}</td>
            <td data-label="Time in status">{{ p.online ? clock(p.sinceSeconds) : '—' }}</td>
          </tr>
          <tr v-if="presence.data.value && !rows.length" class="dte"><td colspan="4">Nobody has signed in yet.</td></tr>
        </tbody></table></div>
    </div>
    <Modal :open="!!opened" :title="opened?.name ?? 'Agent'" wide @close="opened = null"><AgentProfileCard v-if="opened" :agent-id="opened.agentId" /></Modal>
  </div>
</template>

<style scoped>
.ag-range { margin: 0 0 var(--sp-3); max-width: 340px; }
.ag-empty { color: var(--text-muted); margin: 0; }
</style>
