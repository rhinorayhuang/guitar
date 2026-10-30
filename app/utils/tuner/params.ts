/**
 * 調音器可調參數（PRD §5.1.11 + architecture.md §5.3）。
 * 數值為初始值，M0 以 fixtures 校準後鎖定；修改時需同步更新 PRD 表格。
 */
export interface TunerParams {
  minFreq: number
  maxFreq: number
  /** 閘門關閉時需 ≥ 此值才打開 */
  gateOpenDbfs: number
  /** 閘門打開後低於此值才關閉（= gateOpenDbfs 即無遲滯） */
  gateCloseDbfs: number
  minClarity: number
  mpmK: number
  octaveGuardMargin: number
  /** 偵測前低通截止頻率（Hz）；0 = 關閉。架構文件外新增，見 TUN-38 */
  lowpassHz: number
  stabilityCount: number
  stabilityMaxSpreadCents: number
  medianSize: number
  emaTimeConstantMs: number
  resetJumpCents: number
  autoSwitchCount: number
  autoSwitchMinMs: number
  inTuneEnterCents: number
  inTuneEnterMs: number
  inTuneExitCents: number
  inTuneExitMs: number
  inTuneMaxGapMs: number
  holdMs: number
  noisyHintMs: number
  needleRangeCents: number
  minAnalysisIntervalMs: number
}

export const TUNER_PARAMS: Readonly<TunerParams> = Object.freeze({
  minFreq: 70,
  maxFreq: 450,
  gateOpenDbfs: -50,
  gateCloseDbfs: -53,
  minClarity: 0.9,
  mpmK: 0.93,
  // 0.05 時與 mpmK 的交集只剩約 0.02 寬，弱基頻 E2 會穩定報成 E3；待 M0 fixtures 校準
  octaveGuardMargin: 0.01,
  lowpassHz: 5000,
  stabilityCount: 3,
  stabilityMaxSpreadCents: 20,
  medianSize: 5,
  emaTimeConstantMs: 80,
  resetJumpCents: 50,
  autoSwitchCount: 3,
  autoSwitchMinMs: 100,
  inTuneEnterCents: 5,
  inTuneEnterMs: 500,
  inTuneExitCents: 7,
  inTuneExitMs: 200,
  // 一個 unclear 幀後要再 3 幀才有讀數：30 fps 約 133 ms，100 ms 會讓「準了」永遠進不去
  inTuneMaxGapMs: 200,
  holdMs: 1500,
  noisyHintMs: 2000,
  needleRangeCents: 50,
  minAnalysisIntervalMs: 15,
})

export function resolveParams(overrides?: Partial<TunerParams>): TunerParams {
  return { ...TUNER_PARAMS, ...overrides }
}

/** 視窗需涵蓋約 2.8 個最低頻週期，且為 2 的冪（AnalyserNode.fftSize 限制）：2048 @≤48k，4096 @96k */
export function windowSizeFor(sampleRate: number, minFreq: number = TUNER_PARAMS.minFreq): number {
  const needed = Math.ceil((2.8 * sampleRate) / minFreq)
  let size = 1
  while (size < needed) size *= 2
  return size
}
