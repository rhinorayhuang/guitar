import type { TunerParams } from './params'
import { computeRms, toDbfs, type PitchDetector } from './pitchDetector'

export type FrameAnalysis =
  | { kind: 'silent'; dbfs: number }
  | { kind: 'unclear'; dbfs: number; reason: 'no-pitch' | 'out-of-range' | 'low-clarity' }
  | { kind: 'pitched'; dbfs: number; freq: number; clarity: number }

/**
 * 單幀分析（無狀態）：RMS 閘門 → 偵測 → 範圍 / clarity 判斷（architecture.md §4.1）。
 * 閘門遲滯狀態由呼叫端（reducer state）傳入。
 */
export function analyzeFrame(frame: Float32Array, detector: PitchDetector, params: TunerParams, gateWasOpen: boolean): FrameAnalysis {
  const dbfs = toDbfs(computeRms(frame))
  const threshold = gateWasOpen ? params.gateCloseDbfs : params.gateOpenDbfs
  if (!(dbfs >= threshold)) return { kind: 'silent', dbfs }

  const est = detector.detect(frame)
  if (!est) return { kind: 'unclear', dbfs, reason: 'no-pitch' }
  if (est.freq < params.minFreq || est.freq > params.maxFreq) return { kind: 'unclear', dbfs, reason: 'out-of-range' }
  if (est.clarity < params.minClarity) return { kind: 'unclear', dbfs, reason: 'low-clarity' }
  return { kind: 'pitched', dbfs, freq: est.freq, clarity: est.clarity }
}
