<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { LANGUAGE_NAMES, type CallbackFull, type LanguageCode } from '@beverly-call/shared'
import Icon from '@/components/Icon.vue'
import PageHeader from '@/components/PageHeader.vue'
import KpiTile from '@/components/KpiTile.vue'
import Modal from '@/components/Modal.vue'
import EmptyState from '@/components/EmptyState.vue'
import StateBanner from '@/components/StateBanner.vue'
import { api } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { lagosToday, pad2, shortDate } from '@/lib/format'
import { intl } from '@/lib/locale'
import { maskPhone } from '@/lib/mask'
import { useSettings } from '@/stores/settings'
import { useToast } from '@/stores/toast'

const settings = useSettings()
const toast = useToast()
const tone = { Overdue: 'bad', Due: 'ye', Later: 'vi' } as const
const list = useResource(() => api<CallbackFull[]>('/callbacks'))
const show = (p: string) => (settings.p.mask ? maskPhone(p) : p)

/* ---- calendar for the current month ---- */
const month = ref(lagosToday().slice(0, 7))
const cal = ref<{ day: number; status: string; count: number }[]>([])
async function loadCal(): Promise<void> { try { cal.value = await api(`/callbacks/calendar?month=${month.value}`) } catch { cal.value = [] } }
onMounted(loadCal)
const days = computed(() => {
  const [y, m] = month.value.split('-').map(Number) as [number, number]
  const first = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7
  const total = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const by = new Map<number, number>()
  for (const c of cal.value) by.set(c.day, (by.get(c.day) ?? 0) + c.count)
  return { first, cells: Array.from({ length: total }, (_, i) => ({ n: i + 1, count: by.get(i + 1) ?? 0 })) }
})
const today = lagosToday().slice(0, 7) === month.value ? Number(lagosToday().slice(8, 10)) : -1
function shift(d: number): void {
  const [y, m] = month.value.split('-').map(Number) as [number, number]
  month.value = new Date(Date.UTC(y, m - 1 + d, 1)).toISOString().slice(0, 7); void loadCal()
}

const due = computed(() => (list.data.value ?? []).filter((c) => c.status !== 'Later').length)
const late = computed(() => (list.data.value ?? []).filter((c) => c.status === 'Overdue').length)

/* ---- actions ---- */
async function dial(c: CallbackFull): Promise<void> {
  try {
    const r = await api<{ dialled: boolean }>(`/callbacks/${c.id}/start`, { method: 'POST' })
    toast.show(r.dialled ? `Calling ${show(c.phone)}` : `Marked as started. Place the call to ${show(c.phone)} from your softphone.`)
    void list.reload(); void loadCal()
  } catch { toast.show('That callback is no longer in your queue'); void list.reload() }
}
async function done(c: CallbackFull): Promise<void> {
  try { await api(`/callbacks/${c.id}/complete`, { method: 'POST' }); toast.show('Callback completed'); void list.reload(); void loadCal() }
  catch { toast.show('Could not complete that callback') }
}

/* ---- reschedule ---- */
const rs = ref<CallbackFull | null>(null)
const mins = ref<15 | 30 | 60 | 1440>(30)
const outcome = ref<'No answer' | 'Line busy' | 'Wrong number' | 'Customer asked for later'>('No answer')
const note = ref('')
const OPTIONS: [15 | 30 | 60 | 1440, string][] = [[15, '+15 min'], [30, '+30 min'], [60, '+1 hour'], [1440, 'Tomorrow']]
async function saveReschedule(): Promise<void> {
  if (!rs.value) return
  try { const r = await api<CallbackFull>(`/callbacks/${rs.value.id}/reschedule`, { method: 'POST', body: JSON.stringify({ minutes: mins.value, lastOutcome: outcome.value, note: note.value }) }); toast.show(`Callback moved to ${shortDate(r.scheduledFor)}`); rs.value = null; note.value = ''; void list.reload(); void loadCal() }
  catch { toast.show('Could not move that callback') }
}

/* ---- new callback ---- */
const nw = ref(false)
const phone = ref('')
const lang = ref<LanguageCode>('en')
const reason = ref('')
const nmin = ref(30)
async function create(): Promise<void> {
  if (phone.value.trim().length < 5) { toast.show('Enter the customer’s phone number'); return }
  try { await api('/callbacks', { method: 'POST', body: JSON.stringify({ phone: phone.value.trim(), language: lang.value, reason: reason.value || undefined, minutes: nmin.value }) }); toast.show('Callback booked'); nw.value = false; phone.value = ''; reason.value = ''; void list.reload(); void loadCal() }
  catch { toast.show('Could not book the callback') }
}
</script>

<template>
  <section>
    <PageHeader title="Callbacks"><template #actions><button class="y cbq-new" @click="nw = true"><Icon name="plus" />New callback</button></template>
      <div v-hover-scroll class="kp"><KpiTile icon="clock" :value="pad2(due)" label="Due now" /><KpiTile icon="alert" :value="pad2(late)" label="Overdue" dark /><KpiTile icon="phone" :value="pad2((list.data.value ?? []).length)" label="In queue" /></div>
    </PageHeader>
    <StateBanner :loading="list.loading.value && !list.data.value" :error="list.error.value" what="callbacks" />
    <div v-if="list.data.value" class="bento">
      <div class="c s7 w2">
        <div class="hd"><Icon name="phone" /><b>Queue</b></div>
        <EmptyState v-if="!list.data.value.length" icon="check" title="All callbacks done" hint="New requests appear here when a caller asks to be called back." />
        <ul v-else class="cbq">
          <li v-for="c in list.data.value" :key="c.id" :class="{ late: c.status === 'Overdue' }">
            <div class="cbq-main">
              <b>{{ show(c.phone) }}</b>
              <small>{{ c.time }} · {{ c.language }}<template v-if="c.reason"> · {{ c.reason }}</template><template v-if="c.attempts"> · {{ c.attempts }} attempt{{ c.attempts > 1 ? 's' : '' }}</template></small>
            </div>
            <span class="pill" :class="tone[c.status]">{{ c.status }}</span>
            <div class="cbq-act">
              <button class="y cbq-call" :aria-label="`Call ${show(c.phone)}`" @click="dial(c)"><Icon name="phone" /><span>Call</span></button>
              <button :aria-label="`Reschedule ${show(c.phone)}`" title="Reschedule" @click="rs = c"><Icon name="clock" /></button>
              <button :aria-label="`Mark ${show(c.phone)} done`" title="Done" @click="done(c)"><Icon name="check" /></button>
            </div>
          </li>
        </ul>
      </div>
      <div class="c fr s5 w2 stick">
        <div class="hd"><Icon name="clock" /><b>{{ new Date(month + '-01').toLocaleDateString(intl(), { month: 'long', year: 'numeric' }) }}</b>
          <span class="mv"><button aria-label="Previous month" @click="shift(-1)"><Icon name="lft" /></button><button aria-label="Next month" @click="shift(1)"><Icon name="rgt" /></button></span></div>
        <div class="cal"><span v-for="d in 'MTWTFSS'.split('')" :key="d + Math.random()" class="h">{{ d }}</span>
          <span v-for="n in days.first" :key="`e${n}`"></span>
          <span v-for="d in days.cells" :key="d.n" :class="{ t: d.n === today, b: d.count > 0 }" :title="d.count ? `${d.count} callback${d.count > 1 ? 's' : ''}` : ''">{{ d.n }}</span></div>
      </div>
    </div>

    <Modal :open="!!rs" title="Reschedule callback" @close="rs = null">
      <div class="ss"><button v-for="[m, l] in OPTIONS" :key="m" :class="{ on: mins === m }" @click="mins = m">{{ l }}</button></div>
      <label class="fl">Last attempt<select v-model="outcome"><option>No answer</option><option>Line busy</option><option>Wrong number</option><option>Customer asked for later</option></select></label>
      <label class="fl">Note<textarea v-model="note" rows="2" maxlength="500" placeholder="Anything the next agent should know"></textarea></label>
      <template #footer><button @click="rs = null">Cancel</button><button class="y" @click="saveReschedule">Save new time</button></template>
    </Modal>

    <Modal :open="nw" title="New callback" @close="nw = false">
      <label class="fl">Phone number<input v-model="phone" type="tel" inputmode="tel" autocomplete="off" data-autofocus /></label>
      <label class="fl">Language<select v-model="lang"><option v-for="(n, k) in LANGUAGE_NAMES" :key="k" :value="k">{{ n }}</option></select></label>
      <label class="fl">Call back in<select v-model.number="nmin"><option :value="15">15 minutes</option><option :value="30">30 minutes</option><option :value="60">1 hour</option><option :value="240">4 hours</option></select></label>
      <label class="fl">Reason<input v-model="reason" maxlength="300" /></label>
      <template #footer><button @click="nw = false">Cancel</button><button class="y" @click="create">Book callback</button></template>
    </Modal>
  </section>
</template>

<style scoped>
.cbq-new { display: inline-flex; align-items: center; gap: var(--sp-2); padding: 0 var(--sp-4); }
.cbq { list-style: none; margin: 0; padding: 0; display: grid; }
.cbq li { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: var(--sp-3); padding: var(--sp-3) 0; border-top: 1px solid var(--border); }
.cbq li:first-child { border-top: 0; }
.cbq-main { min-width: 0; }
.cbq-main b { font-weight: var(--fw-regular); font-size: var(--fs-lg); font-variant-numeric: tabular-nums; }
.cbq-main small { display: block; color: var(--text-muted); font-size: var(--fs-sm); overflow-wrap: anywhere; }
.cbq-act { display: flex; gap: var(--sp-1); }
.cbq-act button { width: 38px; height: 38px; min-width: 0; padding: 0; background: color-mix(in srgb, var(--text) 7%, transparent); }
.cbq-act .cbq-call { width: auto; display: inline-flex; align-items: center; gap: var(--sp-2); padding: 0 var(--sp-4); background: var(--accent); }
@media (max-width: 639px) {
  .cbq li { grid-template-columns: minmax(0, 1fr) auto; }
  .cbq-act { grid-column: 1 / -1; }
  .cbq-act .cbq-call { flex: 1; justify-content: center; }
}
</style>
