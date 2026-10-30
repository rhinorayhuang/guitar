import type { OutputClockSample } from '~/utils/clock/audibleTime'

/**
 * 共用的 AudioContext 轉接（ADR-009，無 Vue）。所有全域存取都在函式內，SSR import 安全。
 * 本模組不建立、不關閉 context：擁有者是頁面層的功能 composable（useTuner、useMetronome）。
 */

type WindowWithWebkit = typeof globalThis & { webkitAudioContext?: typeof AudioContext }

export function getAudioContextCtor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') return undefined
  const w = window as WindowWithWebkit
  return w.AudioContext ?? w.webkitAudioContext
}

type ClockSource = Pick<AudioContext, 'currentTime'> & Partial<Pick<AudioContext, 'outputLatency' | 'baseLatency' | 'getOutputTimestamp'>>

/** 把 context 的輸出時鐘相關屬性讀成純資料；未支援的屬性以 undefined 表示（特徵偵測） */
export function readOutputClock(ctx: ClockSource, perfNow: number): OutputClockSample {
  const sample: OutputClockSample = { currentTime: ctx.currentTime, perfNow }
  if (typeof ctx.outputLatency === 'number') sample.outputLatency = ctx.outputLatency
  if (typeof ctx.baseLatency === 'number') sample.baseLatency = ctx.baseLatency
  if (typeof ctx.getOutputTimestamp === 'function') {
    try {
      const ts = ctx.getOutputTimestamp()
      if (typeof ts?.contextTime === 'number' && typeof ts.performanceTime === 'number') {
        sample.timestamp = { contextTime: ts.contextTime, performanceTime: ts.performanceTime }
      }
    }
    catch { /* 舊版實作可能丟例外：走 fallback */ }
  }
  return sample
}
