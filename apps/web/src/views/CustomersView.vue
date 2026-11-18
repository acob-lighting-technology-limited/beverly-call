<script setup lang="ts">
import { humanStatus, purchaseTone } from '@/lib/status'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CUSTOMER_PAGE_SIZE, LOW_WALLET_NAIRA, type Customer, type CustomerDetail, type CustomerFull, type CustomerPage, type CustomerProfile, type CustomerSummary, type PlacedCall, type WalletInfo } from '@beverly-call/shared'
import Icon from '@/components/Icon.vue'
import CustomerProfileCard from '@/components/CustomerProfileCard.vue'
import KpiTile from '@/components/KpiTile.vue'
import Modal from '@/components/Modal.vue'
import BindNumberModal from '@/components/BindNumberModal.vue'
import CustomerWork from '@/components/CustomerWork.vue'
import BindingsPanel from '@/components/BindingsPanel.vue'
import StateBanner from '@/components/StateBanner.vue'
import FilterPopover, { type FilterGroup } from '@/components/FilterPopover.vue'
import ViewToggle, { type ViewMode } from '@/components/ViewToggle.vue'
import { api } from '@/lib/api'
import { maskPhone } from '@/lib/mask'
import { dialable, pad2, phoneDigits, shortDate } from '@/lib/format'
import { useSettings } from '@/stores/settings'
import { useToast } from '@/stores/toast'
import { useSession } from '@/stores/session'

const settings = useSettings()
const toast = useToast()
const route = useRoute()
const router = useRouter()
const session = useSession()

/* ---- directory ---- */
const bindOpen = ref(false)
const bindings = ref<InstanceType<typeof BindingsPanel> | null>(null)
const q = ref('')
const list = ref<Customer[]>([])
/** How many customers match the search and filters across the whole directory (the list above only holds what has been loaded). */
const total = ref(0)
/** Totals over the whole directory for the tiles and the area filter. */
const summary = ref<CustomerSummary | null>(null)
const loading = ref(true)
const loadingMore = ref(false)
const error = ref('')
const chip = ref<'all' | 'prepaid' | 'postpaid' | 'low'>('all')
const extra = ref<Record<string, string[]>>({})
const VIEW_KEY = 'bc.cust.view'
const view = ref<ViewMode>((() => { try { return (localStorage.getItem(VIEW_KEY) as ViewMode) || 'cards' } catch { return 'cards' } })())
const setView = (v: ViewMode): void => { view.value = v; try { localStorage.setItem(VIEW_KEY, v) } catch { /* storage blocked */ } }
let timer = 0
let ticket = 0   // a slow answer to an old search must never replace a newer one

const pageUrl = (offset: number): string => {
  const p = new URLSearchParams({ q: q.value.trim(), limit: String(CUSTOMER_PAGE_SIZE), offset: String(offset), kind: chip.value })
  if (extra.value.area?.length) p.set('area', extra.value.area.join(','))
  return `/customers/page?${p}`
}
/** Starts again from the first page whenever the search or a filter changes. */
async function search(): Promise<void> {
  const mine = ++ticket
  loading.value = true; error.value = ''
  try {
    const r = await api<CustomerPage>(pageUrl(0))
    if (mine !== ticket) return
    list.value = r.customers; total.value = r.total
  } catch (e) { if (mine === ticket) error.value = e instanceof Error ? e.message : 'Lookup failed.' }
  finally { if (mine === ticket) loading.value = false }
}
async function loadMore(): Promise<void> {
  if (loading.value || loadingMore.value || list.value.length >= total.value) return
  const mine = ticket
  loadingMore.value = true
  try {
    const r = await api<CustomerPage>(pageUrl(list.value.length))
    if (mine !== ticket) return
    const seen = new Set(list.value.map((c) => c.id))
    list.value = [...list.value, ...r.customers.filter((c) => !seen.has(c.id))]
    total.value = r.total
  } catch { toast.show('Could not load more customers') }
  finally { loadingMore.value = false }
}
function onInput(): void { clearTimeout(timer); timer = window.setTimeout(search, 300) }
watch([chip, extra], () => { void search() }, { deep: true })

// Load the next page on its own as the end of the list scrolls into view; the button below stays for keyboard and assistive-technology users.
const more = ref<HTMLElement | null>(null)
let watcher: IntersectionObserver | null = null
watch(more, (el) => {
  watcher?.disconnect()
  if (el && 'IntersectionObserver' in window) { watcher = new IntersectionObserver((e) => { if (e[0]?.isIntersecting) void loadMore() }, { rootMargin: '300px' }); watcher.observe(el) }
})
onBeforeUnmount(() => { watcher?.disconnect(); clearTimeout(timer) })

const isLow = (c: Customer): boolean => c.balance !== null && c.balance < LOW_WALLET_NAIRA
const groups = computed<FilterGroup[]>(() => [{ key: 'area', label: 'Area', options: summary.value?.areas ?? [...new Set(list.value.map((c) => c.area).filter(Boolean))].sort() }])
const shown = computed(() => list.value)
const remaining = computed(() => Math.max(total.value - list.value.length, 0))
const count = (n: number): string => n.toLocaleString('en-US')
const show = (p: string) => (settings.p.mask ? maskPhone(p) : p)
const initials = (n: string) => n.split(' ').map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase()
const hue = (n: string): number => [...n].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 17)
const stateOf = (c: Customer): 'low' | 'none' | 'ok' => (isLow(c) ? 'low' : c.balance === null ? 'none' : 'ok')
const stateLabel = (c: Customer): string => ({ low: 'Low wallet', none: 'No wallet', ok: 'All good' })[stateOf(c)]
const money = (n: number | null) => (n === null ? '---' : `NGN ${n.toLocaleString('en-US')}`)

/* ---- detail ---- */
const sel = ref<Customer | null>(null)
const detail = ref<CustomerDetail | null>(null)
const full = ref<CustomerFull | null>(null)
const wallet = ref<WalletInfo | null>(null)
const profile = ref<CustomerProfile | null>(null)
const detailError = ref('')

async function open(c: Customer): Promise<void> {
  sel.value = c; detail.value = null; full.value = null; wallet.value = null; profile.value = null; detailError.value = ''
  if (route.query.open !== c.id) void router.replace({ path: '/cust', query: { open: c.id } })
  const id = encodeURIComponent(c.id)
  const [d, f, w, pr] = await Promise.allSettled([api<CustomerDetail>(`/customers/${id}/detail`), api<CustomerFull>(`/customers/${id}/full`), api<WalletInfo>(`/customers/${id}/wallet`), api<CustomerProfile>(`/customers/${id}/profile`)])
  if (d.status === 'fulfilled') detail.value = d.value; else detailError.value = 'Purchase history could not be loaded.'
  if (f.status === 'fulfilled') full.value = f.value
  if (w.status === 'fulfilled') wallet.value = w.value
  if (pr.status === 'fulfilled') profile.value = pr.value
}
function back(): void { sel.value = null; void router.replace({ path: '/cust' }) }
async function openById(id: string): Promise<void> {
  const known = list.value.find((c) => c.id === id)
  if (known) return open(known)
  // By id, so a link to any customer opens them, however far down the directory they are.
  try { await open(await api<Customer>(`/customers/${encodeURIComponent(id)}`)) } catch { toast.show('That customer could not be found') }
}
onMounted(async () => {
  void api<CustomerSummary>('/customers/summary').then((r) => { summary.value = r }).catch(() => { /* the tiles fall back to the loaded page */ })
  await search()
  if (typeof route.query.open === 'string') await openById(route.query.open)
})
watch(() => route.query.open, (id) => { if (typeof id === 'string' && sel.value?.id !== id) void openById(id); if (!id) sel.value = null })

const lastContacted = computed(() => (full.value?.lastContacted ? shortDate(full.value.lastContacted) : 'No contact yet'))
const jump = (id: string): void => { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
const STAGES = computed(() => [['Reported', full.value?.stages.reported ?? 0, 100], ['Escalated', full.value?.stages.escalated ?? 0, 82], ['Working', full.value?.stages.working ?? 0, 64], ['Fixed', full.value?.stages.fixed ?? 0, 46]] as const)
const meterNo = computed(() => detail.value?.meters[0] ?? sel.value?.meter ?? '—')
const canSms = computed(() => !!sel.value)

/* ---- actions ---- */
async function copy(t: string): Promise<void> { try { await navigator.clipboard.writeText(t); toast.show('Copied') } catch { toast.show('Copy is blocked in this browser') } }
const smsOpen = ref(false); const sms = ref('')
const noteOpen = ref(false); const note = ref('')
async function sendSms(): Promise<void> {
  if (!sel.value || !sms.value.trim()) return
  try { const r = await api<{ result: string }>('/customers/sms', { method: 'POST', body: JSON.stringify({ phone: sel.value.phone, text: sms.value.trim(), customerRef: sel.value.id }) }); toast.show(r.result === 'sent' ? 'SMS sent' : 'SMS not sent: the carrier is not configured'); smsOpen.value = false; sms.value = '' }
  catch { toast.show('SMS failed') }
}
async function saveNote(): Promise<void> {
  if (!sel.value || !note.value.trim()) return
  try { await api(`/customers/${encodeURIComponent(sel.value.id)}/notes`, { method: 'POST', body: JSON.stringify({ text: note.value.trim() }) }); toast.show('Note saved'); noteOpen.value = false; note.value = ''; full.value = await api<CustomerFull>(`/customers/${encodeURIComponent(sel.value.id)}/full`) }
  catch { toast.show('Could not save the note') }
}
async function book(): Promise<void> {
  if (!sel.value) return
  try { await api('/callbacks', { method: 'POST', body: JSON.stringify({ phone: sel.value.phone, customerRef: sel.value.id, reason: 'Scheduled from the customer page', minutes: 30 }) }); toast.show('Callback booked for 30 minutes'); full.value = await api<CustomerFull>(`/customers/${encodeURIComponent(sel.value.id)}/full`) }
  catch { toast.show('Could not book the callback') }
}
async function refreshWork(): Promise<void> { if (sel.value) full.value = await api<CustomerFull>(`/customers/${encodeURIComponent(sel.value.id)}/full`).catch(() => full.value) }
const canCall = computed(() => session.role === 'agent' || session.role === 'supervisor')

/** Click to call: opens the call on the call screen (customer, history, notes, wrap-up), then hands the number to this device's dialler. */
const calling = ref(false)
const hasPhone = computed(() => phoneDigits(sel.value?.phone ?? '').length >= 7)
async function callCustomer(): Promise<void> {
  if (!sel.value || calling.value) return
  calling.value = true
  try {
    const r = await api<PlacedCall>(`/customers/${encodeURIComponent(sel.value.id)}/call`, { method: 'POST' })
    toast.show(`Calling ${r.name}. Your phone or dialler opens now; log the outcome here when you finish.`, 6000)
    const a = document.createElement('a')
    a.href = `tel:${dialable(r.phone)}`
    a.click()
    await router.push('/call')
  } catch (e) { toast.show(e instanceof Error ? e.message : 'Could not start the call') }
  finally { calling.value = false }
}
</script>

<template>
  <section>
    <!-- Directory -->
    <div v-if="!sel">
      <div v-sticky-head class="head"><div class="ht"><h1>Customers</h1><button v-if="canCall || session.role === 'admin'" @click="bindOpen = true">Bind a number</button></div>
        <div v-hover-scroll class="kp"><KpiTile icon="users" :value="count(summary?.total ?? total)" label="Customers" /><KpiTile icon="wallet" :value="summary ? count(summary.low) : '—'" label="Low wallet" dark /></div></div>
      <BindingsPanel ref="bindings" />
      <div class="cdh">
        <label class="sch"><Icon name="users" /><input v-model="q" type="search" aria-label="Search customers" placeholder="Search by name, phone, email or meter" @input="onInput" /></label>
        <FilterPopover v-model="extra" :groups="groups" /><ViewToggle :model-value="view" @update:model-value="setView" />
      </div>
      <div v-hover-scroll class="chs" role="group" aria-label="Quick filters">
        <button v-for="c in ([['all', 'All'], ['prepaid', 'Prepaid'], ['postpaid', 'Postpaid'], ['low', 'Low wallet']] as const)" :key="c[0]" :class="{ on: chip === c[0] }" @click="chip = c[0]">{{ c[1] }}</button></div>
      <div class="cnt" aria-live="polite" style="margin: 8px 2px">Showing {{ count(list.length) }} of {{ count(total) }} customers</div>
      <StateBanner :loading="loading" :error="error" what="customers" />
      <div v-if="!loading && !error && !shown.length" class="ban">No customer found. Try a name, phone, email or meter number.</div>
      <div v-if="view === 'cards'" class="cgrid">
        <button v-for="c in shown" :key="c.id" class="cx" :aria-label="`Open ${c.name}`" @click="open(c)">
          <span class="cx-top">
            <span class="cx-av" :style="{ '--h': hue(c.name) }" aria-hidden="true">{{ initials(c.name) }}</span>
            <span class="cx-id"><b>{{ c.name || 'Unnamed customer' }}</b><small>{{ c.phone ? show(c.phone) : 'No phone on file' }}</small></span>
            <span class="cx-st" :data-s="stateOf(c)"><i></i>{{ stateLabel(c) }}</span>
          </span>
          <span class="cx-meta">
            <span><Icon name="bolt" /><em>{{ c.meter || 'No meter' }}</em></span>
            <span v-if="c.accountNo"><Icon name="users" /><em>{{ c.accountNo }}</em></span>
          </span>
          <span class="cx-tags"><i v-if="c.area">{{ c.area }}</i><i v-if="c.tariff">{{ c.tariff }}</i></span>
          <span class="cx-bal"><small>{{ c.balance === null ? 'Wallet' : 'Wallet balance' }}</small><b :class="{ none: c.balance === null }">{{ money(c.balance) }}</b></span>
        </button>
      </div>
      <div v-else class="c"><div class="scroll dv-table"><table class="rt cust-t"><thead><tr><th>Customer</th><th>Meter</th><th>Phone</th><th>Area</th><th>Balance</th><th>Status</th></tr></thead>
        <tbody><tr v-for="c in shown" :key="c.id" tabindex="0" @click="open(c)" @keydown.enter="open(c)">
          <td data-label="Customer"><span class="nmc"><span class="cav" style="background: var(--yel)">{{ initials(c.name) }}</span>{{ c.name }}</span></td><td data-label="Meter">{{ c.meter || '—' }}</td><td data-label="Phone">{{ show(c.phone) }}</td>
          <td data-label="Area">{{ c.area }}</td><td data-label="Balance">{{ money(c.balance) }}</td><td data-label="Status"><span class="pill" :class="isLow(c) ? 'ye' : 'vi'">{{ isLow(c) ? 'Low wallet' : 'All good' }}</span></td></tr></tbody></table></div></div>
      <div v-if="!loading && !error && remaining > 0" ref="more" class="cmore">
        <button :disabled="loadingMore" @click="loadMore">{{ loadingMore ? 'Loading…' : `Show ${count(Math.min(remaining, CUSTOMER_PAGE_SIZE))} more` }}</button>
        <small>{{ count(remaining) }} more not shown yet</small></div>
    </div>

    <!-- Detail -->
    <div v-else>
      <div v-sticky-head class="head"><div class="ht"><button class="ib" aria-label="Back to all customers" @click="back"><Icon name="lft" /></button><h1>{{ sel.name }}</h1></div>
        <div v-hover-scroll class="kp"><KpiTile icon="bolt" :value="pad2(detail?.purchases.length ?? 0)" label="Recent vends" /><KpiTile icon="flag" :value="pad2(full?.stages.reported ?? 0)" label="Cases" dark /><KpiTile icon="clock" :value="pad2(full?.callbacks.length ?? 0)" label="Callbacks" /></div></div>
      <div class="bento"><div class="hero">
        <div class="pc"><div class="pa">{{ initials(sel.name) }}</div><b style="font-weight: 400; font-size: 18px">{{ sel.name }}</b><div style="color: var(--mut)">{{ sel.accountType }}, {{ sel.area }}</div>
          <div class="ia"><button v-if="canCall" class="ia-call" aria-label="Call customer" title="Call this customer" :disabled="!hasPhone || calling" @click="callCustomer"><Icon name="phone" /></button>
          <button v-if="canCall" aria-label="Schedule callback" title="Book a callback" @click="book"><Icon name="clock" /></button>
            <button aria-label="SMS" title="Send SMS" :disabled="!canSms" @click="smsOpen = true"><Icon name="mail" /></button>
            <button aria-label="Add note" title="Add note" @click="noteOpen = true"><Icon name="plus" /></button></div></div>
        <div class="dr">
          <div><Icon name="bolt" /><div class="tx"><small>Meter number</small><b>{{ meterNo }}</b></div><button aria-label="Copy meter" :disabled="!detail?.meters.length" @click="copy(meterNo)"><Icon name="copy" /></button></div>
          <div><Icon name="phone" /><div class="tx"><small>Phone</small><b>{{ show(sel.phone) }}</b></div><button aria-label="Copy phone" @click="copy(sel.phone)"><Icon name="copy" /></button></div>
          <div><Icon name="wallet" /><div class="tx"><small>Wallet balance</small><b>{{ money(sel.balance) }}</b></div></div>
          <div><Icon name="clock" /><div class="tx"><small>Last contacted</small><b>{{ lastContacted }}</b></div></div></div>
      </div>
      <div v-hover-scroll class="jm" role="navigation" aria-label="Jump to section">
        <button @click="jump('sx-h')">History</button><button @click="jump('sx-t')">Cases</button><button @click="jump('sx-l')">Timeline</button><button @click="jump('sx-n')">Notes</button><button @click="jump('sx-c')">Callbacks</button></div>

      <StateBanner :loading="!detail && !detailError && !full" :error="detailError" what="history" />
      <div class="col s8 w2">
        <div id="sx-h" class="c fr"><div class="hd"><Icon name="wallet" /><b>Recent purchases</b></div>
          <div v-for="p in detail?.purchases ?? []" :key="p.id" class="row"><span>{{ shortDate(p.at) }} · NGN {{ p.amount.toLocaleString('en-US') }}<small style="display: block; color: var(--mut)">{{ p.tokenMasked }}</small></span><span class="pill" :class="purchaseTone(p.status)">{{ humanStatus(p.status) }}</span></div>
          <p v-if="detail && !detail.purchases.length" style="color: var(--mut)">No purchases found.</p></div>
        <div id="sx-l" class="c fr"><div class="hd"><Icon name="clock" /><b>Timeline</b></div>
          <div v-for="(e, i) in full?.timeline ?? []" :key="i" class="row"><span>{{ shortDate(e.at) }} {{ e.text }}</span><span class="pill" :class="e.tone">{{ e.kind }}</span></div>
          <p v-if="full && !full.timeline.length" style="color: var(--mut)">Nothing recorded for this customer yet.</p></div>
      </div>
      <div class="col s4 w2">
        <CustomerProfileCard v-if="profile" :profile="profile" :customer-id="sel.id" />
        <div class="c fr"><div class="hd"><Icon name="wallet" /><b>Wallet</b><span class="pill" :class="wallet ? (wallet.status === 'active' ? 'ok' : 'ye') : 'vi'">{{ wallet ? wallet.status : 'No wallet' }}</span></div>
          <div class="row"><span>Balance</span><b style="font-weight: 400">{{ wallet ? `NGN ${wallet.balance.toLocaleString('en-US')}` : '---' }}</b></div>
          <div class="row"><span>On hold</span><span>{{ wallet ? `NGN ${wallet.holds.toLocaleString('en-US')}` : '---' }}</span></div>
          <div class="row"><span>Available</span><span>{{ wallet ? `NGN ${wallet.available.toLocaleString('en-US')}` : '---' }}</span></div>
          <p v-if="!wallet" style="color: var(--mut); font-size: 12px; margin: 6px 0 0">No Beverly customer wallet is linked to this customer's email or phone number.</p></div>
        <div id="sx-t" class="c fr"><div class="hd"><Icon name="chart" /><b>Case stages</b></div>
          <div class="fn"><div v-for="s in STAGES" :key="s[0]" :style="{ width: `${s[2]}%` }"><span>{{ s[0] }}</span><b>{{ s[1] }}</b></div></div>
          </div>
        <CustomerWork v-if="sel" :customer="sel" @changed="refreshWork" />
        <div id="sx-n" class="c fr"><div class="hd"><Icon name="note" /><b>Notes</b></div>
          <div v-for="(n, i) in full?.notes ?? []" :key="i" class="cm"><b>{{ n.by }}</b><span>{{ n.text }}</span><small>{{ shortDate(n.at) }}</small></div>
          <p v-if="full && !full.notes.length" style="color: var(--mut)">No notes yet.</p></div>
        <div id="sx-c" class="c fr"><div class="hd"><Icon name="clock" /><b>Callbacks</b></div>
          <div v-for="b in full?.callbacks ?? []" :key="b.id" class="row"><span>{{ shortDate(b.scheduledFor) }}</span><span class="pill vi">{{ b.status }}</span></div>
          <p v-if="full && !full.callbacks.length" style="color: var(--mut)">No callbacks.</p></div>
      </div></div>
    </div>

    <Modal :open="smsOpen" title="Text the customer" @close="smsOpen = false">
      <p style="color: var(--mut); margin: 0">To {{ sel ? show(sel.phone) : '' }}</p>
      <textarea v-model="sms" rows="3" maxlength="320" placeholder="Type a message" data-autofocus></textarea>
      <template #footer><button @click="smsOpen = false">Cancel</button><button class="y" @click="sendSms">Send</button></template>
    </Modal>
    <Modal :open="noteOpen" title="Add a note" @close="noteOpen = false">
      <textarea v-model="note" rows="3" maxlength="1000" placeholder="What should the next agent know?" data-autofocus></textarea>
      <template #footer><button @click="noteOpen = false">Cancel</button><button class="y" @click="saveNote">Save note</button></template>
    </Modal>
    <BindNumberModal :open="bindOpen" @close="bindOpen = false" @done="bindings?.load()" />
  </section>
</template>

<style scoped>
/* "Show more" under the directory: the next page also loads by itself as this scrolls into view. */
.cmore { display: flex; flex-direction: column; align-items: center; gap: 6px; margin: 14px 0 6px; }
.cmore small { color: var(--mut); font-size: 11px; font-variant-numeric: tabular-nums; }
/* The Call button is the main action in the profile row. */
.ia-call { background: var(--yel); color: var(--on-accent); }
.ia-call:disabled { opacity: .4; }
</style>
