<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Icon from '@/components/Icon.vue'

const props = defineProps<{ open: boolean; title: string; wide?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const box = ref<HTMLElement | null>(null)
let returnTo: HTMLElement | null = null

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') { e.stopPropagation(); emit('close'); return }
  if (e.key !== 'Tab' || !box.value) return
  const f = [...box.value.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex="0"]')].filter((x) => !x.hasAttribute('disabled') && x.offsetParent !== null)
  if (!f.length) return
  const first = f[0]!, last = f[f.length - 1]!
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
}

// Keyboard users land inside the dialog and return to the control that opened it.
watch(() => props.open, async (o) => {
  if (o) {
    returnTo = document.activeElement as HTMLElement | null
    document.addEventListener('keydown', onKey, true)
    await nextTick()
    box.value?.querySelector<HTMLElement>('[data-autofocus],input,textarea,select,button.y')?.focus({ preventScroll: true })
    ;(box.value?.querySelector('[data-autofocus]') ?? box.value)?.setAttribute?.('tabindex', '-1')
  } else {
    document.removeEventListener('keydown', onKey, true)
    returnTo?.focus?.({ preventScroll: true })
  }
})
onBeforeUnmount(() => document.removeEventListener('keydown', onKey, true))

/* Swipe down on the handle or header to dismiss, like a native sheet. */
const dy = ref(0)
const dragging = ref(false)
let startY = 0
function dragStart(e: PointerEvent): void {
  if ((e.target as HTMLElement).closest('button')) return
  dragging.value = true; startY = e.clientY
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
function dragMove(e: PointerEvent): void { if (dragging.value) dy.value = Math.max(0, e.clientY - startY) }
function dragEnd(): void {
  if (!dragging.value) return
  dragging.value = false
  const close = dy.value > 110
  dy.value = 0
  if (close) emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="sheet-up">
      <div v-if="open" class="mdl-scrim" @mousedown.self="emit('close')">
        <div ref="box" class="mdl" :class="{ wide, dragging }" :style="dy ? { transform: `translateY(${dy}px)` } : undefined" role="dialog" aria-modal="true" :aria-label="title">
          <div class="mdl-top" @pointerdown="dragStart" @pointermove="dragMove" @pointerup="dragEnd" @pointercancel="dragEnd">
            <span class="mdl-grab" aria-hidden="true"></span>
            <header class="mdl-h"><b>{{ title }}</b><button class="mdl-x" aria-label="Close" @click="emit('close')"><Icon name="x" /></button></header>
          </div>
          <div class="mdl-b"><slot /></div>
          <footer v-if="$slots.footer" class="mdl-f"><slot name="footer" /></footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style>
/* Bottom sheet: rises from under the screen edge like a native app sheet; swipe the handle down to dismiss. */
.mdl-scrim { position: fixed; inset: 0; z-index: var(--z-popover, 80); display: flex; align-items: flex-end; justify-content: center; padding: 0; background: rgba(0, 0, 0, 0.4); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
.mdl { width: min(560px, 100%); max-height: min(90dvh, 780px); display: flex; flex-direction: column; background: var(--card); color: var(--ink); border-radius: var(--r-xl, 28px) var(--r-xl, 28px) 0 0; box-shadow: 0 -12px 48px rgba(0, 0, 0, 0.32); overflow: hidden; padding-bottom: env(safe-area-inset-bottom, 0px); transition: transform 0.32s cubic-bezier(0.32, 0.72, 0, 1); will-change: transform; }
.mdl.dragging { transition: none; }
.mdl.wide { width: min(820px, 100%); }
.mdl-top { touch-action: none; cursor: grab; }
.mdl-grab { display: block; width: 40px; height: 5px; margin: 8px auto 0; border-radius: 99px; background: color-mix(in srgb, var(--ink) 22%, transparent); }
.mdl-h { display: flex; align-items: center; gap: 8px; padding: 10px 16px 8px; }
.mdl-h b { flex: 1; font-weight: 400; font-size: 17px; }
.mdl-x { width: 34px; height: 34px; min-width: 0; padding: 0; background: var(--panel); }
.mdl-b { padding: 4px 16px 16px; overflow: auto; }
.mdl-f { display: flex; gap: 8px; justify-content: flex-end; padding: 10px 16px 14px; border-top: 1px dotted var(--line); }
.sheet-up-enter-active, .sheet-up-leave-active { transition: opacity 0.28s ease; }
.sheet-up-enter-active .mdl, .sheet-up-leave-active .mdl { transition: transform 0.32s cubic-bezier(0.32, 0.72, 0, 1); }
.sheet-up-leave-active .mdl { transition-timing-function: cubic-bezier(0.4, 0, 1, 1); transition-duration: 0.24s; }
.sheet-up-enter-from, .sheet-up-leave-to { opacity: 0; }
.sheet-up-enter-from .mdl, .sheet-up-leave-to .mdl { transform: translateY(100%); }
@media (prefers-reduced-motion: reduce) { .sheet-up-enter-active, .sheet-up-leave-active, .sheet-up-enter-active .mdl, .sheet-up-leave-active .mdl, .mdl { transition-duration: 0.01ms; } }
:root[data-rm] .mdl, :root[data-rm] .mdl-scrim { transition: none; }
</style>
