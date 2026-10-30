import { TUNER_STRINGS } from './strings'

/** 參考音播放計畫（ADR-007）：含泛音的 PeriodicWave，基頻 = 目標頻率（TUN-90） */
export interface ReferenceTonePlan {
  frequency: number
  durationS: number
  /** ≥ 0.02（避免爆音） */
  fadeInS: number
  fadeOutS: number
  peakGain: number
  /** PeriodicWave 實部係數（index 0 = DC） */
  harmonics: readonly number[]
}

const HARMONICS = Object.freeze([0, 1, 0.6, 0.4, 0.25, 0.15, 0.1])

export function referenceTonePlan(stringIndex: number): ReferenceTonePlan {
  const string = TUNER_STRINGS[stringIndex]
  if (!string) throw new RangeError(`invalid string index ${stringIndex}`)
  return {
    frequency: string.frequency,
    durationS: 2,
    fadeInS: 0.03,
    fadeOutS: 0.08,
    peakGain: 0.3,
    harmonics: HARMONICS,
  }
}
