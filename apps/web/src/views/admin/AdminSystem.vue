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
const keptForever = computed(() => retention.data.value?.retentionDays === null)
const needsAttention = computed(() => !!retention.data.value && (retention.data.value.pendingPurge > 0 || retention.data.value.lastFailed > 0))
</script>

<template>
  <div class="bento">
      <div class="c dk s6"><div class="hd"><Icon name="db" /><b>Connections</b><button aria-label="Refresh connections" class="adm-ic" @click="reloadAll"><Icon name="auto" /></button></div>
        <StateBanner :loading="connections.loading.value" :error="connections.error.value" what="connections" />
        <div v-for="c in connections.data.value ?? []" :key="c.name" class="row"><span>{{ c.name }}<small class="adm-sub">{{ c.detail }}</small></span><span class="pill" :class="c.ok ? 'ok' : 'ye'">{{ c.ok ? 'Connected' : 'Check' }}</span></div></div>

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
.adm-ic { margin-left: auto; height: 30px; min-width: 30px; padding: 0 8px; }
.adm-sub { display: block; color: var(--text-muted); font-size: var(--fs-sm); margin: var(--sp-1) 0 0; }
.adm-note { margin: 2px 0 var(--sp-2); }
.c.dk .adm-sub { color: color-mix(in srgb, var(--text-inverse) 70%, transparent); }
</style>
