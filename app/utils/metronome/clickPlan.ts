import { CLICK } from './params'

export interface ClickPlan {
  /** Hz */
  frequency: number
  type: 'sine' | 'triangle' | 'square'
  /** 0–1 */
  peakGain: number
  /** 線性上升 */
  attackS: number
  /** 指數衰減到 0.0001 的時間 */
  durationS: number
}

export function clickPlan(accent: boolean): ClickPlan {
  return { ...(accent ? CLICK.accent : CLICK.normal) }
}
