/** Where the user last pressed a navigation control, so a screen can grow out of that exact spot (the admin console does). */
export const morphOrigin = { x: 0, y: 0, at: 0 }

export function markMorph(e: PointerEvent | MouseEvent): void {
  const el = e.currentTarget as HTMLElement | null
  if (!el) return
  const r = el.getBoundingClientRect()
  morphOrigin.x = r.left + r.width / 2
  morphOrigin.y = r.top + r.height / 2
  morphOrigin.at = Date.now()
}

/** Origin relative to a container, or null when the last press was too long ago (keyboard or direct URL): no morph then. */
export function morphWithin(box: DOMRect | undefined): { x: number; y: number } | null {
  if (!box || Date.now() - morphOrigin.at > 1500) return null
  return { x: Math.round(morphOrigin.x - box.left), y: Math.round(morphOrigin.y - box.top) }
}

/** The last normal (non-admin) screen, so the admin Back control returns to where the user was. Set by the router. */
export const navMemory = { lastNormal: '' }
