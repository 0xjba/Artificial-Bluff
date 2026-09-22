/** Short synthesised table sounds (no audio files): chips, cards, a fold, a win. Browser only. */
export type Sound = 'chip' | 'card' | 'fold' | 'win'

let context: AudioContext | null = null

const TONES: Record<Sound, Array<{ freq: number; at: number; length: number; type: OscillatorType; gain: number }>> = {
  chip: [
    { freq: 2400, at: 0, length: 0.04, type: 'triangle', gain: 0.08 },
    { freq: 3100, at: 0.05, length: 0.04, type: 'triangle', gain: 0.06 },
  ],
  card: [{ freq: 900, at: 0, length: 0.06, type: 'sawtooth', gain: 0.03 }],
  fold: [{ freq: 220, at: 0, length: 0.12, type: 'sine', gain: 0.05 }],
  win: [
    { freq: 523, at: 0, length: 0.12, type: 'triangle', gain: 0.07 },
    { freq: 659, at: 0.1, length: 0.12, type: 'triangle', gain: 0.07 },
    { freq: 784, at: 0.2, length: 0.2, type: 'triangle', gain: 0.07 },
  ],
}

/** Plays a sound (quietly does nothing where Web Audio is unavailable). */
export function playSound(kind: Sound): void {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return
  context ??= new AudioContext()
  const now = context.currentTime
  for (const tone of TONES[kind]) {
    const osc = context.createOscillator()
    const gain = context.createGain()
    osc.type = tone.type
    osc.frequency.value = tone.freq
    gain.gain.setValueAtTime(tone.gain, now + tone.at)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.at + tone.length)
    osc.connect(gain).connect(context.destination)
    osc.start(now + tone.at)
    osc.stop(now + tone.at + tone.length + 0.02)
  }
}

/** The sound for a log line kind, if any. */
export function soundFor(kind: 'hand' | 'action' | 'street' | 'win' | 'end', text: string): Sound | null {
  if (kind === 'street') return 'card'
  if (kind === 'win' || kind === 'end') return 'win'
  if (kind === 'action') return /\bfolds?\b/.test(text) ? 'fold' : /\b(check|checks)\b/.test(text) ? null : 'chip'
  return null
}
