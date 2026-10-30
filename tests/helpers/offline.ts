import { analyzeFrame, type FrameAnalysis } from '~/utils/tuner/frameAnalysis'
import type { TunerParams } from '~/utils/tuner/params'
import { createPitchDetector, detectorOptionsFor } from '~/utils/tuner/pitchDetector'
import { createTunerPipeline } from '~/utils/tuner/pipeline'
import type { TunerMode } from '~/utils/tuner/strings'
import type { TunerState } from '~/utils/tuner/tunerMachine'
import { selectTunerView, type TunerView } from '~/utils/tuner/tunerView'

export interface OfflineFrame { t: number; analysis: FrameAnalysis; state: TunerState; view: TunerView }

/** 以 hop = round(sr/60) 切 W 長度視窗餵 pipeline；t = 視窗結尾的訊號時間（ms） */
export function runOffline(signal: Float32Array, sr: number, opts: { mode?: TunerMode; params?: Partial<TunerParams> } = {}): OfflineFrame[] {
  const pipeline = createTunerPipeline({ sampleRate: sr, ...opts })
  // 另建一個 detector 只為了記錄每幀 analysis（pipeline 不對外暴露）
  const detector = createPitchDetector(detectorOptionsFor(sr, pipeline.params))
  const W = pipeline.windowSize
  const hop = Math.round(sr / 60)
  const frames: OfflineFrame[] = []
  for (let start = 0; start + W <= signal.length; start += hop) {
    const frame = signal.subarray(start, start + W)
    const t = ((start + W) / sr) * 1000
    const analysis = analyzeFrame(frame, detector, pipeline.params, pipeline.state.gateOpen)
    const state = pipeline.process(frame, t)
    frames.push({ t, analysis, state, view: selectTunerView(state, pipeline.params) })
  }
  return frames
}
