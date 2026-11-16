<script setup lang="ts">
/** Account, station, meter and tariff details from Beverly's management pages.
 *  Used by: CustomersView. Data: GET /api/customers/:id/profile. */
import { computed } from 'vue'
import type { CustomerProfile } from '@beverly-call/shared'
import Icon from '@/components/Icon.vue'
import Pill from '@/components/Pill.vue'
import { maskPhone } from '@/lib/mask'
import { useSettings } from '@/stores/settings'

const props = defineProps<{ profile: CustomerProfile; customerId?: string }>()
const settings = useSettings()
/** The CRM often has no account number, so the card shows the next best identifier rather than a dash: meter number, then customer ID. */
const ident = computed<{ label: string; value: string }>(() => {
  const a = props.profile.account.accountNo
  if (a) return { label: 'Account number', value: a }
  const m = props.profile.meters.find((x) => x.meterId)?.meterId
  if (m) return { label: 'Meter number', value: m }
  return props.customerId ? { label: 'Customer ID', value: props.customerId } : { label: 'Account number', value: '—' }
})
const dash = (v: string | number | null | undefined): string => (v === null || v === undefined || v === '' ? '—' : String(v))
const since = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const price = (n: number | null): string => (n === null ? '' : ` · NGN ${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}/kWh`)
</script>

<template>
  <div class="c fr" aria-label="Account and meters">
    <div class="hd"><Icon name="user" /><b>Account</b><Pill :tone="profile.account.status === 'active' ? 'ok' : 'ye'">{{ dash(profile.account.status) }}</Pill></div>
    <div class="row"><span>{{ ident.label }}</span><b style="font-weight: 400; overflow-wrap: anywhere; text-align: right">{{ ident.value }}</b></div>
    <div class="row"><span>Site</span><span>{{ dash(profile.account.siteId) }}</span></div>
    <div class="row"><span>KYC</span><span>{{ profile.account.kycTier === null ? '—' : `Tier ${profile.account.kycTier}` }}{{ profile.account.kycStatus ? `, ${profile.account.kycStatus}` : '' }}</span></div>
    <div class="row"><span>Phone</span><span>{{ settings.p.mask ? maskPhone(profile.account.phone ?? '') : dash(profile.account.phone) }}</span></div>
    <div class="row"><span>Email</span><span>{{ dash(profile.account.email) }}</span></div>
    <div class="row"><span>Customer since</span><span>{{ since(profile.account.since) }}</span></div>
    <div class="hd" style="margin-top: 10px"><Icon name="db" /><b>Meters, stations and tariffs</b></div>
    <p v-if="!profile.meters.length" style="color: var(--mut); margin: 4px 0">No meters linked in your stations.</p>
    <div v-for="m in profile.meters" :key="m.meterId" class="row" style="align-items: flex-start">
      <span>{{ m.meterId }}<small style="display: block; color: var(--mut)">{{ dash(m.stationId) }}{{ m.type ? ` · ${m.type}` : '' }}{{ m.label ? ` · ${m.label}` : '' }}</small></span>
      <span style="text-align: right">{{ m.tariff ? (m.tariff.name ?? m.tariff.id) : 'No tariff' }}<small style="display: block; color: var(--mut)">{{ m.tariff ? `${m.tariff.id}${price(m.tariff.pricePerKwh)}` : '' }}{{ m.status ? ` · ${m.status}` : '' }}</small></span>
    </div>
  </div>
</template>
