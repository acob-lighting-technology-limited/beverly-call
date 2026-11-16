/** Small, dependency-free helpers for the SVG charts. Coordinates are percentages (0 to 100) so the same numbers
 *  drive both the SVG paths and the HTML hover overlays. */

export interface XY { x: number; y: number }

/** Maps values to chart coordinates: x spread evenly, y inverted so larger values sit higher. `pad` keeps the line off the edges. */
export function toPoints(values: number[], max: number, pad = 6): XY[] {
  const n = values.length
  return values.map((v, i) => ({
    x: n < 2 ? 50 : (i / (n - 1)) * 100,
    y: 100 - pad - (max <= 0 ? 0 : (v / max) * (100 - pad * 2)),
  }))
}

/** Smooth path through the points (Catmull-Rom converted to cubic Bezier), with control points clamped so it never overshoots the plot. */
export function smoothPath(pts: XY[], tension = 0.18): string {
  if (!pts.length) return ''
  if (pts.length === 1) return `M${pts[0]!.x},${pts[0]!.y}`
  const clamp = (v: number): number => Math.min(100, Math.max(0, v))
  let d = `M${pts[0]!.x.toFixed(2)},${pts[0]!.y.toFixed(2)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[i + 2] ?? p2
    const c1 = { x: p1.x + (p2.x - p0.x) * tension, y: clamp(p1.y + (p2.y - p0.y) * tension) }
    const c2 = { x: p2.x - (p3.x - p1.x) * tension, y: clamp(p2.y - (p3.y - p1.y) * tension) }
    d += ` C${c1.x.toFixed(2)},${c1.y.toFixed(2)} ${c2.x.toFixed(2)},${c2.y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`
  }
  return d
}

/** Closed area under a smooth path, down to the baseline. */
export const areaPath = (pts: XY[]): string => (pts.length ? `${smoothPath(pts)} L${pts[pts.length - 1]!.x},100 L${pts[0]!.x},100 Z` : '')

/** Rounds a maximum up to a clean axis value (7 becomes 8, 130 becomes 150) so gridlines read well. */
export function niceMax(v: number): number {
  if (v <= 0) return 1
  const exp = Math.pow(10, Math.floor(Math.log10(v)))
  const f = v / exp
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return nice * exp
}

/** Centred moving average, for the trend line over bars. */
export function movingAverage(values: number[], window = 3): number[] {
  const half = Math.floor(window / 2)
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - half), Math.min(values.length, i + half + 1))
    return slice.reduce((a, b) => a + b, 0) / slice.length
  })
}

/** Index of the nearest of `n` evenly spaced points for a pointer at fraction `f` (0 to 1) across the plot. */
export const nearestIndex = (f: number, n: number): number => (n < 2 ? 0 : Math.min(n - 1, Math.max(0, Math.round(f * (n - 1)))))

/** Percent change from `prev` to `cur`; null when there is nothing to compare. */
export const pctChange = (cur: number, prev: number): number | null => (prev === 0 ? null : Math.round(((cur - prev) / prev) * 1000) / 10)
