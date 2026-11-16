import type { Directive } from 'vue'

/** Sticky screen header behaviour, shared by PageHeader and any hand-written `.head`.
 *  Publishes the header's real height as `--sh` on its screen (so toolbars, table headers and side panels
 *  offset by the exact amount) and folds the KPI strip away once the user scrolls, bringing it back at the top. */
interface Cleanup { off: () => void }
const handles = new WeakMap<HTMLElement, Cleanup>()

export const vStickyHead: Directive<HTMLElement> = {
  mounted(el) {
    const view = el.closest<HTMLElement>('.view')
    if (!view) return
    const publish = (): void => { view.style.setProperty('--sh', `${Math.round(el.getBoundingClientRect().height)}px`) }
    publish()
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    let raf = 0
    const onScroll = (): void => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const y = view.scrollTop
        // frosted backdrop only while content actually scrolls beneath the header
        el.classList.toggle('stuck', y > 4)
        // hysteresis: fold at 64px, unfold below 16px, so it never flickers around a single value
        if (y > 64) el.classList.add('compact')
        else if (y < 16) el.classList.remove('compact')
      })
    }
    onScroll()
    view.addEventListener('scroll', onScroll, { passive: true })
    handles.set(el, { off: () => { ro.disconnect(); view.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf) } })
  },
  unmounted(el) { handles.get(el)?.off(); handles.delete(el) },
}
