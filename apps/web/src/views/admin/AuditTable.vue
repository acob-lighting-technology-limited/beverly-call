<script setup lang="ts">
/** Tamper-evident audit log as a table (or cards), searchable and paginated on the server so the whole log can be browsed.
 *  Data: GET /api/audit?page&pageSize&q, GET /api/admin/audit/verify. Used by: AdminSystem. */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { AUDIT_PAGE_SIZES, type AuditPage } from '@beverly-call/shared'
import Icon from '@/components/Icon.vue'
import StateBanner from '@/components/StateBanner.vue'
import ViewToggle from '@/components/ViewToggle.vue'
import { api } from '@/lib/api'
import { dateTime } from '@/lib/format'
import { useResource } from '@/lib/use-resource'
import { useViewMode } from '@/lib/use-view-mode'
import { useSession } from '@/stores/session'

const session = useSession()
const canEdit = computed(() => session.user?.role === 'admin' && !session.viewAs)
const { mode, set } = useViewMode('admin-audit')

const page = ref(1)
const pageSize = ref<number>(25)
const search = ref('')
const query = ref('')   // debounced copy of `search`
let timer = 0
watch(search, (v) => { clearTimeout(timer); timer = window.setTimeout(() => { query.value = v.trim() }, 300) })
onBeforeUnmount(() => clearTimeout(timer))

const log = useResource(() => api<AuditPage>(`/audit?page=${page.value}&pageSize=${pageSize.value}${query.value ? `&q=${encodeURIComponent(query.value)}` : ''}`))
watch([page, pageSize, query], () => void log.reload())
watch([pageSize, query], () => { page.value = 1 })

const total = computed(() => log.data.value?.total ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const from = computed(() => (total.value ? (page.value - 1) * pageSize.value + 1 : 0))
const to = computed(() => Math.min(total.value, page.value * pageSize.value))
const go = (p: number): void => { page.value = Math.min(pages.value, Math.max(1, p)) }

const verifyMsg = ref('')
async function verify(): Promise<void> {
  try {
    const r = await api<{ checked: number; brokenAt: number | null }>('/admin/audit/verify')
    verifyMsg.value = r.brokenAt === null ? `Chain intact: ${r.checked} entries checked.` : `Chain broken at entry ${r.brokenAt + 1}. Investigate now.`
  } catch { verifyMsg.value = 'Could not verify the chain.' }
}
const roleTone = (r: string): string => (r === 'admin' ? 'vi' : r === 'supervisor' ? 'ye' : r === 'system' ? 'bad' : 'ok')
</script>

<template>
  <div class="c s12 w2 aud">
    <div class="hd"><Icon name="db" /><b>Audit log</b><span class="pill ok">Tamper-evident</span>
      <button v-if="canEdit" class="aud-ic" aria-label="Verify audit chain" title="Verify the whole chain" @click="verify"><Icon name="check" /></button></div>
    <p v-if="verifyMsg" role="status" class="aud-note">{{ verifyMsg }}</p>

    <div class="dtb">
      <label class="sch"><Icon name="x-srch" /><input v-model="search" type="search" aria-label="Search the audit log" placeholder="Search action, role or reference" /></label>
      <span class="n" aria-live="polite">{{ total }} entries</span>
      <ViewToggle :model-value="mode" @update:model-value="set" />
    </div>

    <StateBanner :loading="log.loading.value && !log.data.value" :error="log.error.value" what="the audit log" />
    <div v-if="log.data.value" class="scroll" :class="mode === 'cards' ? 'dv-cards' : 'dv-table'" :aria-busy="log.loading.value">
      <table class="rt"><thead><tr><th>When</th><th>Action</th><th>Role</th><th>Entity</th><th>Reference</th></tr></thead>
        <tbody>
          <tr v-for="a in log.data.value.rows" :key="a.seq">
            <td data-label="When">{{ dateTime(a.at) }}</td>
            <td data-label="Action"><b class="aud-action">{{ a.action }}</b></td>
            <td data-label="Role"><span class="pill" :class="roleTone(a.actorRole)">{{ a.actorRole }}</span></td>
            <td data-label="Entity">{{ a.entity }}</td>
            <td data-label="Reference"><code class="aud-ref" :title="a.entityId">{{ a.entityId.length > 14 ? `${a.entityId.slice(0, 14)}…` : a.entityId }}</code></td>
          </tr>
          <tr v-if="!log.data.value.rows.length" class="dte"><td colspan="5">{{ query ? 'No entries match your search.' : 'No activity yet.' }}</td></tr>
        </tbody></table>
    </div>

    <div v-if="log.data.value" class="dtf aud-foot">
      <label class="aud-size">Rows per page
        <select v-model.number="pageSize" aria-label="Rows per page"><option v-for="n in AUDIT_PAGE_SIZES" :key="n" :value="n">{{ n }}</option></select></label>
      <span class="aud-range" aria-live="polite">{{ from }}–{{ to }} of {{ total }}</span>
      <button aria-label="First page" title="First page" :disabled="page <= 1" @click="go(1)"><Icon name="lft" /><Icon name="lft" class="aud-dbl" /></button>
      <button aria-label="Previous page" title="Previous page" :disabled="page <= 1" @click="go(page - 1)"><Icon name="lft" /></button>
      <span class="aud-page">Page {{ page }} of {{ pages }}</span>
      <button aria-label="Next page" title="Next page" :disabled="page >= pages" @click="go(page + 1)"><Icon name="rgt" /></button>
      <button aria-label="Last page" title="Last page" :disabled="page >= pages" @click="go(pages)"><Icon name="rgt" /><Icon name="rgt" class="aud-dbl" /></button>
    </div>
  </div>
</template>

<style scoped>
.aud-ic { margin-left: auto; height: 30px; min-width: 30px; padding: 0 8px; }
.aud-note { margin: 2px 0 var(--sp-2); }
.aud-action { font-weight: var(--fw-regular); }
.aud-ref { font-size: var(--fs-xs); color: var(--text-muted); }
.aud-foot { flex-wrap: wrap; justify-content: space-between; gap: var(--sp-2); }
.aud-size { display: inline-flex; align-items: center; gap: var(--sp-2); }
.aud-size select { width: auto; padding: 4px 10px; border-radius: var(--r-pill); }
.aud-range { margin-left: auto; margin-right: 0; }
.aud-page { margin: 0 var(--sp-1); }
.aud-foot button .aud-dbl { margin-left: -12px; }
.aud-foot button { gap: 0; }
</style>
