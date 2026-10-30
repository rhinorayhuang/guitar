import type { NoteName } from '~/types/chord'
import { STANDARD_TUNING, midiToFrequency, noteLabel, noteOctave, pitchClass } from '~/utils/music'

export interface TunerString {
  /** 0..5，0 = 第 6 弦（與 STANDARD_TUNING 相同） */
  index: number
  /** 6..1（顯示「第 N 弦」） */
  stringNumber: number
  midi: number
  name: NoteName
  octave: number
  label: string
  /** 由 midiToFrequency 計算，不得寫死（TUN-01） */
  frequency: number
}

export const TUNER_STRINGS: readonly TunerString[] = Object.freeze(
  STANDARD_TUNING.map((midi, index) => Object.freeze({
    index,
    stringNumber: 6 - index,
    midi,
    name: pitchClass(midi),
    octave: noteOctave(midi),
    label: noteLabel(midi),
    frequency: midiToFrequency(midi),
  })),
)

export type TunerMode = { kind: 'auto' } | { kind: 'manual'; stringIndex: number }

export const AUTO_MODE: TunerMode = Object.freeze({ kind: 'auto' })

export function centsBetween(freq: number, reference: number): number {
  return 1200 * Math.log2(freq / reference)
}

/** 比較 |cents| 取最近弦；距離相等取較低弦（較小 index）（TUN-10） */
export function nearestStringIndex(freq: number): number {
  let best = 0
  let bestDist = Infinity
  for (const s of TUNER_STRINGS) {
    const dist = Math.abs(centsBetween(freq, s.frequency))
    // 1e-9 容差：幾何平均交界在浮點下可能差一點點，仍視為相等而取較低弦
    if (dist < bestDist - 1e-9) {
      best = s.index
      bestDist = dist
    }
  }
  return best
}

export function frequencyToTarget(freq: number, mode: TunerMode): { string: TunerString; cents: number } {
  const string = TUNER_STRINGS[mode.kind === 'manual' ? mode.stringIndex : nearestStringIndex(freq)]!
  return { string, cents: centsBetween(freq, string.frequency) }
}

export const isValidStringIndex = (i: unknown): i is number =>
  typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < TUNER_STRINGS.length

/** TUN-15：localStorage 讀寫的純函式部分 */
export const TUNER_MODE_STORAGE_KEY = 'guitar-learning:tuner-mode:v1'

export function serializeMode(mode: TunerMode): string {
  return JSON.stringify(mode.kind === 'manual' ? { v: 1, kind: 'manual', stringIndex: mode.stringIndex } : { v: 1, kind: 'auto' })
}

/** 壞資料一律回傳 null（容錯） */
export function parseStoredMode(raw: string | null): TunerMode | null {
  if (!raw) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  }
  catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const d = data as Record<string, unknown>
  if (d.v !== 1) return null
  if (d.kind === 'auto') return { kind: 'auto' }
  if (d.kind === 'manual' && isValidStringIndex(d.stringIndex)) return { kind: 'manual', stringIndex: d.stringIndex }
  return null
}
