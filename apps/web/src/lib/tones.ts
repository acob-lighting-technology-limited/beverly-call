/** Keypad tones (two simultaneous frequencies) and alert sounds, all generated in the browser. Silent when the user turned sounds off. */
const DT: Record<string, [number, number]> = {
  '1': [697, 1209], '2': [697, 1336], '3': [697, 1477], '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
  '7': [852, 1209], '8': [852, 1336], '9': [852, 1477], '*': [941, 1209], '0': [941, 1336], '#': [941, 1477],
}
let ctx: AudioContext | null = null

export function playDtmf(key: string, enabled: boolean): void {
  const f = DT[key]
  if (!f || !enabled) return
  try {
    ctx = ctx ?? new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    void ctx.resume()
    const g = ctx.createGain()
    g.gain.value = 0.05
    g.connect(ctx.destination)
    for (const hz of f) {
      const o = ctx.createOscillator()
      o.frequency.value = hz
      o.connect(g)
      o.start()
      o.stop(ctx.currentTime + 0.12)
    }
  } catch { /* audio blocked until a user gesture */ }
}

function tone(freqs: number[], start: number, len: number, gain: number): void {
  if (!ctx) return
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, ctx.currentTime + start)
  g.gain.linearRampToValueAtTime(gain, ctx.currentTime + start + 0.02)
  g.gain.linearRampToValueAtTime(0, ctx.currentTime + start + len)
  g.connect(ctx.destination)
  for (const hz of freqs) {
    const o = ctx.createOscillator()
    o.frequency.value = hz
    o.connect(g)
    o.start(ctx.currentTime + start)
    o.stop(ctx.currentTime + start + len + 0.02)
  }
}
function audio(): boolean {
  try {
    ctx = ctx ?? new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    void ctx.resume()
    return true
  } catch { return false }   // audio blocked until a user gesture
}

/** Short two-note chime for a new alert. Silent when the user turned alert sounds off. */
export function playChime(enabled: boolean): void {
  if (!enabled || !audio()) return
  tone([880], 0, 0.14, 0.06); tone([1318], 0.16, 0.2, 0.06)
}

/** Phone-style double ring, repeated three times, for a call that is ringing. Silent when alert sounds are off. */
export function playRing(enabled: boolean): void {
  if (!enabled || !audio()) return
  for (let i = 0; i < 3; i++) { tone([440, 480], i * 1.6, 0.4, 0.07); tone([440, 480], i * 1.6 + 0.6, 0.4, 0.07) }
}
