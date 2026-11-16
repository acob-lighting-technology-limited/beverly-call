<script setup lang="ts">
/** The signed-in agent's next shifts and whether they are on shift now. Data: GET /api/shifts/me. Used by: the Profile panel. */
import { computed, onMounted, ref } from 'vue'
import type { RosterCell } from '@beverly-call/shared'
import { api } from '@/lib/api'

const days = ref<RosterCell[]>([])
const onNow = ref(false)
const enforced = ref(false)
const loaded = ref(false)

onMounted(async () => {
  try { const r = await api<{ days: RosterCell[]; onShiftNow: boolean; enforced: boolean }>('/shifts/me'); days.value = r.days; onNow.value = r.onShiftNow; enforced.value = r.enforced } catch { days.value = [] }
  loaded.value = true
})
const week = computed(() => days.value.slice(0, 7))
const today = computed(() => days.value[0])
const assigned = computed(() => days.value.some((d) => d.source !== 'none'))
const dow = (d: string): string => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })
const dayNum = (d: string): string => d.slice(8)
</script>

<template>
  <div v-if="loaded" class="ms">
    <div class="ms-h">
      <b>My shifts</b>
      <span v-if="assigned" class="pill" :class="onNow ? 'ok' : 'vi'">{{ onNow ? 'On shift now' : 'Off shift' }}</span>
      <small v-if="enforced && assigned && !onNow">Calls are only routed during your shift.</small>
    </div>
    <p v-if="!assigned" class="ms-m">No rotation has been set for you yet. Your admin sets shifts.</p>
    <template v-else>
      <p class="ms-t"><template v-if="today?.name">Today: <b>{{ today.name }}</b>, {{ today.start }} to {{ today.end }}</template><template v-else>Today: day off</template></p>
      <div class="ms-w"><span v-for="d in week" :key="d.day" class="ms-d" :class="{ off: !d.name }" :style="d.color ? { '--c': d.color } : {}" :title="d.name ? `${d.name} ${d.start} to ${d.end}` : 'Day off'">
        <small>{{ dow(d.day) }} {{ dayNum(d.day) }}</small><b>{{ d.name ?? 'Off' }}</b><em v-if="d.name">{{ d.start }}</em></span></div>
    </template>
  </div>
</template>

<style scoped>
.ms { padding: 10px 12px; border-radius: 16px; background: var(--card); border: 1px solid color-mix(in srgb, var(--ink) 8%, transparent); }
.ms-h { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; } .ms-h b { font-weight: 500; flex: 1; } .ms-h small { flex-basis: 100%; color: var(--mut); font-size: 11px; }
.ms-m, .ms-t { margin: 6px 0 0; font-size: 12px; color: var(--mut); } .ms-t b { color: var(--ink); font-weight: 500; }
.ms-w { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; margin-top: 8px; }
.ms-d { --c: #9a9aa3; display: grid; justify-items: center; gap: 0; padding: 5px 2px; border-radius: 10px; background: color-mix(in srgb, var(--c) 24%, transparent); border: 1px solid color-mix(in srgb, var(--c) 50%, transparent); text-align: center; min-width: 0; }
.ms-d.off { background: transparent; border-style: dashed; } .ms-d small { font-size: 9.5px; color: var(--mut); } .ms-d b { font-weight: 500; font-size: 10.5px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .ms-d em { font-style: normal; font-size: 9.5px; color: var(--mut); }
</style>
