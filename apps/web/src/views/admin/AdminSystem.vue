<script setup lang="ts">
/** System health and records: connections, retention proof, tamper-evident audit log. Used by: AdminView. */
import { computed } from 'vue'
import type { Connection, RetentionStatus } from '@beverly-call/shared'
import Icon from '@/components/Icon.vue'
import StateBanner from '@/components/StateBanner.vue'
import AuditTable from './AuditTable.vue'
import { api } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { shortDate } from '@/lib/format'

const retention = useResource(() => api<RetentionStatus>('/admin/retention'))
const connections = useResource(() => api<Connection[]>('/admin/connections'))

function reloadAll(): void { void connections.reload(); void retention.reload() }
const connList = computed(() => connections.data.value ?? [])
const healthy = computed(() => connList.value.filter((c) => c.ok).length)
const keptForever = computed(() => retention.data.value?.retentionDays === null)
const needsAttention = computed(() => !!retention.data.value && (retention.data.value.pendingPurge > 0 || retention.data.value.lastFailed > 0))
</script>

<template>
  <div class="bento">
      <div class="c s6 cx-card"><div class="hd"><Icon name="db" /><b>Connections</b>
        <span v-if="connList.length" class="cx-sum" :class="{ warn: healthy < connList.length }" :title="`${healthy} of ${connList.length} services are healthy`">{{ healthy }}/{{ connList.length }} healthy</span>
        <button aria-label="Refresh connections" title="Refresh" class="adm-ic" @click="reloadAll"><Icon name="auto" /></button></div>
        <StateBanner :loading="connections.loading.value" :error="connections.error.value" what="connections" />
        <ul v-if="connList.length" class="cx-list">
          <li v-for="c in connList" :key="c.name" class="cx" :class="{ bad: !c.ok }">
            <i class="cx-dot" aria-hidden="true"></i>
            <span class="cx-name" :title="c.name">{{ c.name }}</span>
            <span class="cx-val" :title="c.detail">{{ c.detail }}</span>
            <span class="sr">{{ c.ok ? 'Healthy' : 'Needs attention' }}</span>
          </li>
        </ul></div>

      <div class="c s6"><div class="hd"><Icon name="lock" /><b>Retention proof</b>
        <span v-if="retention.data.value" class="pill" :class="needsAttention ? 'ye' : 'ok'">{{ keptForever ? 'Kept forever' : needsAttention ? 'Needs attention' : 'On schedule' }}</span></div>
        <StateBanner :loading="retention.loading.value" :error="retention.error.value" what="retention status" />
        <template v-if="retention.data.value">
          <div v-if="keptForever" class="row"><span>Policy</span><span>Recordings are never deleted</span></div>
          <div class="row"><span>Last purge</span><span>{{ retention.data.value.lastRunAt ? shortDate(retention.data.value.lastRunAt) : 'Never run' }}</span></div>
          <div class="row"><span>Last run</span><span>{{ retention.data.value.lastDeleted }} deleted · {{ retention.data.value.lastHeld }} held · {{ retention.data.value.lastFailed }} failed</span></div>
          <div v-if="retention.data.value.pendingPurge" class="row"><span>Expired, waiting to purge</span><span>{{ retention.data.value.pendingPurge }}</span></div></template></div>

      <AuditTable />
  </div>
</template>

<style scoped>
.adm-ic { margin-left: auto; height: 28px; min-width: 28px; padding: 0 6px; }
.cx-sum + .adm-ic { margin-left: 0; }
.adm-sub { display: block; color: var(--text-muted); font-size: var(--fs-sm); margin: var(--sp-1) 0 0; }
.adm-note { margin: 2px 0 var(--sp-2); }
.c.dk .adm-sub { color: color-mix(in srgb, var(--text-inverse) 70%, transparent); }

/* Connections: one dense line per service. Everything comes from the theme's tokens (surface, ink, line and the status pairs
   --ok/--okt and --ye/--yet), so it follows light, dark, every palette, glass and high contrast without any colour of its own. */
.cx-card .hd { gap: 8px; }
.cx-sum { margin-left: auto; padding: 2px 10px; border-radius: var(--r-pill); font-size: 11px; line-height: 1.5; white-space: nowrap; font-variant-numeric: tabular-nums;
  background: var(--ok); color: var(--okt); }
.cx-sum.warn { background: var(--ye); color: var(--yet); }
.cx-list { list-style: none; margin: 6px 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 230px), 1fr)); gap: 6px; }
.cx { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; column-gap: 8px; min-height: 34px; padding: 6px 10px; border-radius: 12px;
  background: var(--panel); border: 1px solid var(--line); color: var(--ink); font-size: 12.5px; }
.cx-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--st-on); box-shadow: 0 0 0 3px color-mix(in srgb, var(--st-on) 25%, transparent); }
.cx-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cx-val { max-width: 11em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--mut); }
/* A service that needs attention: the theme's own warning pair, with room for the message. */
.cx.bad { grid-template-columns: auto minmax(0, 1fr); row-gap: 2px; background: var(--ye); color: var(--yet); border-color: color-mix(in srgb, var(--yet) 28%, transparent); }
.cx.bad .cx-dot { background: var(--st-break); box-shadow: 0 0 0 3px color-mix(in srgb, var(--st-break) 30%, transparent); }
.cx.bad .cx-name { white-space: normal; }
.cx.bad .cx-val { grid-column: 2; max-width: none; white-space: normal; color: inherit; opacity: .85; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>

