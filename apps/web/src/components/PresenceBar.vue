<script setup lang="ts">
/** A slim reminder under the top bar whenever I am on Break or Away: running hours, minutes and seconds, a details tooltip
 *  on hover or focus, and one tap back to Available. Hidden on the call screen. Used by: App.vue. */
import { computed } from 'vue'
import { durationLong, hms, sinceLabel } from '@/lib/format'
import { usePresence } from '@/stores/presence'

const presence = usePresence()
const show = computed(() => presence.unavailable && !presence.locked)
const text = computed(() => (presence.choice === 'break' ? 'On break' : presence.reason === 'idle' ? 'Away, idle' : 'Away'))
const name = computed(() => (presence.choice === 'break' ? 'Break' : 'Away'))
const how = computed(() => (presence.reason === 'idle' ? 'Set automatically after you were idle' : `You chose ${name.value}`))
</script>

<template>
  <Transition name="pbar">
    <div v-if="show" class="pbar" :class="presence.choice" role="status">
      <span class="pb-t">{{ text }}</span>
      <span class="pb-time" tabindex="0" aria-describedby="pb-tip">{{ hms(presence.elapsedSeconds) }}
        <span id="pb-tip" class="pb-tip" role="tooltip">
          <b>{{ name }} for {{ durationLong(presence.elapsedSeconds) }}</b>
          <span>Since {{ sinceLabel(presence.since) }}</span>
          <span>{{ how }}</span>
          <span>You are not receiving calls</span>
        </span>
      </span>
      <button type="button" class="pb-back" @click="presence.set('available')">Back to available</button>
    </div>
  </Transition>
</template>

<style scoped>
.pbar { --c: var(--st-break); position: fixed; z-index: 14; right: 16px; top: calc(env(safe-area-inset-top, 0px) + 56px); display: flex; align-items: center; gap: var(--sp-3); padding: 4px 4px 4px var(--sp-4); border-radius: var(--r-pill); background: color-mix(in srgb, var(--c) 22%, var(--surface)); border: 1px solid color-mix(in srgb, var(--c) 55%, transparent); box-shadow: var(--sh-3); color: var(--text); font-size: var(--fs-sm); -webkit-backdrop-filter: blur(14px) saturate(1.4); backdrop-filter: blur(14px) saturate(1.4); }
.pbar.away { --c: var(--st-away); }
.pb-t { font-weight: var(--fw-regular); }
.pb-time { position: relative; font-variant-numeric: tabular-nums; min-width: 4.2ch; text-align: center; color: var(--text-muted); cursor: help; border-radius: var(--r-pill); padding: 2px 4px; }
.pb-time:hover, .pb-time:focus-visible { color: var(--text); background: color-mix(in srgb, var(--text) 8%, transparent); }
.pb-time:focus-visible { outline: var(--focus-ring); outline-offset: 1px; }
.pb-tip { position: absolute; top: calc(100% + 10px); right: -8px; z-index: 2; display: none; gap: 2px; width: max-content; max-width: 260px; padding: 8px 12px; border-radius: var(--r-md); background: var(--surface-inverse); color: var(--text-inverse); text-align: left; font-size: var(--fs-xs); line-height: 1.35; box-shadow: var(--sh-3); pointer-events: none; }
.pb-tip b { font-size: var(--fs-sm); font-weight: var(--fw-medium); }
.pb-tip span { opacity: 0.8; }
.pb-time:hover .pb-tip, .pb-time:focus-visible .pb-tip { display: grid; }
.pb-back { height: 30px; min-width: 0; padding: 0 var(--sp-3); border-radius: var(--r-pill); background: var(--accent); color: var(--on-accent-text); font-weight: var(--fw-medium); }
.pbar-enter-active, .pbar-leave-active { transition: opacity var(--dur-base) ease, transform var(--dur-base) var(--ease); }
.pbar-enter-from, .pbar-leave-to { opacity: 0; transform: translateY(-8px); }
@media (prefers-reduced-motion: reduce) { .pbar-enter-active, .pbar-leave-active { transition: none; } }
@media (max-width: 639px) { .pbar { right: 12px; max-width: calc(100vw - 24px); } }
</style>
