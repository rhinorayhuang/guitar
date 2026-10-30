import { analyzeFrame } from './frameAnalysis'
import { resolveParams, type TunerParams } from './params'
import { createPitchDetector, detectorOptionsFor } from './pitchDetector'
import type { TunerMode } from './strings'
import { createInitialTunerState, tunerReducer, type TunerEvent, type TunerState } from './tunerMachine'

/** 偵測 + 狀態機組裝；瀏覽器與離線測試走同一條 process()，F 測試結果才能代表實機行為 */
export interface TunerPipeline {
  readonly sampleRate: number
  readonly windowSize: number
  readonly params: Readonly<TunerParams>
  readonly state: TunerState
  process(frame: Float32Array, now: number): TunerState
  dispatch(event: Exclude<TunerEvent, { type: 'frame' }>): TunerState
}

export function createTunerPipeline(opts: { sampleRate: number; mode?: TunerMode; params?: Partial<TunerParams> }): TunerPipeline {
  const params = Object.freeze(resolveParams(opts.params))
  const detectorOptions = detectorOptionsFor(opts.sampleRate, params)
  const detector = createPitchDetector(detectorOptions)
  let state = createInitialTunerState(opts.mode)

  return {
    sampleRate: opts.sampleRate,
    windowSize: detectorOptions.windowSize,
    params,
    get state() {
      return state
    },
    process(frame, now) {
      const analysis = analyzeFrame(frame, detector, params, state.gateOpen)
      state = tunerReducer(state, { type: 'frame', analysis, now }, params)
      return state
    },
    dispatch(event) {
      state = tunerReducer(state, event, params)
      return state
    },
  }
}
