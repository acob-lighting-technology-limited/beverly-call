<script setup lang="ts">
/** Availability picker for everyone who signs in. Three large options (no dots): an icon in a tinted circle, a label,
 *  and a clear selected state. While on a live call the server holds the status, so the picker locks and says why.
 *  Depends on: presence store. Used by: App.vue account menu. */
import { computed } from 'vue'
import type { SelfPresenceStatus } from '@beverly-call/shared'
import Icon from '@/components/Icon.vue'
import { hms } from '@/lib/format'
import { usePresence } from '@/stores/presence'
import { useSession } from '@/stores/session'

const presence = usePresence()
const session = useSession()

const OPTIONS: { id: SelfPresenceStatus; label: string; icon: string }[] = [
  { id: 'available', label: 'Available', icon: 'phone' },
  { id: 'break', label: 'Break', icon: 'wait' },
  { id: 'away', label: 'Away', icon: 'moon' },
]
const isAdmin = computed(() => session.user?.role === 'admin')
const hint = computed(() => {
  if (presence.locked) return presence.status === 'busy' ? 'You are on a call. Your status unlocks after wrap-up.' : 'In wrap-up. Finish the call notes to take the next call.'
  const t = hms(presence.elapsedSeconds)
  if (presence.choice === 'break') return `On break for ${t}. You will not receive calls.`
  if (presence.choice === 'away') return presence.reason === 'idle' ? `Set to Away after being idle, ${t} ago. Pick Available when you are back.` : `Away for ${t}. You will not receive calls.`
  return isAdmin.value ? 'Visible to supervisors. Admins do not take calls.' : 'You will receive calls.'
})
</script>

<template>
  <div class="stp">
    <div class="stp-grid" role="radiogroup" aria-label="Your status">
      <button v-for="o in OPTIONS" :key="o.id" type="button" role="radio" class="stp-opt" :class="[o.id, { on: presence.choice === o.id }]" :aria-checked="presence.choice === o.id" :disabled="presence.locked" @click="presence.set(o.id)">
        <span class="stp-ic"><Icon :name="o.icon" /></span>
        <span class="stp-label">{{ o.label }}</span>
      </button>
    </div>
    <p class="stp-hint" role="status" aria-live="polite">{{ hint }}</p>
  </div>
</template>

<style scoped>
.stp { margin: 8px 0 6px; }
.stp-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.stp-opt { --c: var(--st-on); position: relative; display: grid; justify-items: center; align-content: center; gap: 6px; height: auto; min-width: 0; padding: 10px 4px 9px; border-radius: var(--r-lg); background: color-mix(in srgb, var(--text) 5%, transparent); color: var(--text-muted); border: 1.5px solid transparent; transition: background var(--dur-fast), border-color var(--dur-fast), color var(--dur-fast), transform var(--dur-base) var(--ease-spring); }
.stp-opt.break { --c: var(--st-break); }
.stp-opt.away { --c: var(--st-away); }
.stp-ic { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: color-mix(in srgb, var(--c) 18%, transparent); color: color-mix(in srgb, var(--c) 78%, var(--text)); transition: background var(--dur-fast), color var(--dur-fast); }
.stp-ic :deep(.i) { width: 18px; height: 18px; }
.stp-label { font-size: var(--fs-sm); font-weight: var(--fw-regular); }
.stp-opt:hover:not(:disabled):not(.on) { background: color-mix(in srgb, var(--c) 10%, transparent); color: var(--text); }
.stp-opt:active:not(:disabled) { transform: scale(0.96); }
.stp-opt.on { background: color-mix(in srgb, var(--c) 16%, transparent); border-color: var(--c); color: var(--text); }
.stp-opt.on .stp-ic { background: var(--c); color: #111; }
.stp-opt:disabled { opacity: 0.5; cursor: default; }
.stp-hint { margin: 8px 2px 0; color: var(--text-muted); font-size: var(--fs-xs); line-height: 1.35; min-height: 2.7em; }
@media (prefers-reduced-motion: reduce) { .stp-opt { transition: none; } }
</style>
