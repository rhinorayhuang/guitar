import type { FrameAnalysis } from '~/utils/tuner/frameAnalysis'
import { resolveParams, type TunerParams } from '~/utils/tuner/params'
import { TUNER_STRINGS, type TunerMode } from '~/utils/tuner/strings'
import { createInitialTunerState, tunerReducer, type TunerState } from '~/utils/tuner/tunerMachine'

/** 直接建構 FrameAnalysis 時間序列給 reducer 測試（不經過音訊） */
export const FRAME_MS = 1000 / 60

export const pitched = (freq: number): FrameAnalysis => ({ kind: 'pitched', dbfs: -20, freq, clarity: 0.98 })
export const silent = (): FrameAnalysis => ({ kind: 'silent', dbfs: -Infinity })
export const unclear = (): FrameAnalysis => ({ kind: 'unclear', dbfs: -30, reason: 'low-clarity' })

/** 對某弦偏移 cents 的頻率 */
export const atCents = (stringIndex: number, cents: number) => TUNER_STRINGS[stringIndex]!.frequency * 2 ** (cents / 1200)

/** 可逐步推進時間的 reducer 驅動器；now 為下一幀的時間 */
export class Driver {
  state: TunerState
  now = 0
  readonly params: TunerParams
  constructor(mode?: TunerMode, params?: Partial<TunerParams>) {
    this.state = createInitialTunerState(mode)
    this.params = resolveParams(params)
  }

  /** 餵一幀（時間 = now），之後推進 dt */
  feed(analysis: FrameAnalysis, dt = FRAME_MS): TunerState {
    this.state = tunerReducer(this.state, { type: 'frame', analysis, now: this.now }, this.params)
    this.now += dt
    return this.state
  }

  /** 在 durMs 內持續餵幀；回傳 [時間, 狀態] 序列 */
  repeat(analysis: FrameAnalysis | ((i: number) => FrameAnalysis), durMs: number, dt = FRAME_MS): [number, TunerState][] {
    const out: [number, TunerState][] = []
    const end = this.now + durMs
    for (let i = 0; this.now < end - 1e-9; i++) {
      const t = this.now
      out.push([t, this.feed(typeof analysis === 'function' ? analysis(i) : analysis, dt)])
    }
    return out
  }
}
