import { MAX_LATENCY_S } from './params'

/**
 * 「此刻喇叭正在播哪個 AudioContext 時間」的估計（ADR-011、§5.1）。純函式，數值由轉接層讀入。
 */

export interface OutputClockSample {
  currentTime: number
  /** 未支援時 undefined */
  outputLatency?: number
  baseLatency?: number
  /** AudioContext.getOutputTimestamp() */
  timestamp?: { contextTime: number; performanceTime: number }
  /** rAF 給的 DOMHighResTimeStamp（ms） */
  perfNow: number
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const clampLatency = (x: number | undefined, max: number) => (finite(x) ? Math.min(max, Math.max(0, x)) : 0)

export function estimateAudibleTime(s: OutputClockSample, maxLatencyS: number = MAX_LATENCY_S): number {
  const ts = s.timestamp
  let audible: number
  if (ts && finite(ts.contextTime) && finite(ts.performanceTime) && ts.contextTime > 0 && ts.performanceTime > 0 && finite(s.perfNow)) {
    audible = ts.contextTime + (s.perfNow - ts.performanceTime) / 1000
  }
  else {
    audible = s.currentTime - clampLatency(s.outputLatency, maxLatencyS) - clampLatency(s.baseLatency, maxLatencyS)
  }
  // 喇叭不可能播「未來」的聲音；也擋掉 timestamp 異常
  return Math.min(s.currentTime, Math.max(s.currentTime - maxLatencyS, audible))
}
