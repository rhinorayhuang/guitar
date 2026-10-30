import { frequencyToMidi, midiToFrequency } from '~/utils/music'
import type { FrameAnalysis } from './frameAnalysis'
import { TUNER_PARAMS, type TunerParams } from './params'
import { AUTO_MODE, TUNER_STRINGS, centsBetween, nearestStringIndex, type TunerMode } from './strings'

/**
 * 調音狀態機（ADR-004）：純函式 reducer，時間由事件帶入，不呼叫 Date.now() / performance.now()。
 * 每個 frame 事件的處理順序見 architecture.md §4.2。
 */

export type TuneStatus = 'tracking' | 'approaching' | 'inTune'

export interface TunerReading {
  stringIndex: number
  /** 平滑後頻率 */
  freq: number
  /** 平滑後浮點 cents（對目標弦） */
  cents: number
  /** 對稱捨入後整數；判定「準了」與畫面都用它 */
  displayCents: number
  /** 最後一次有效讀數時間（ms） */
  at: number
}

export interface TunerState {
  mode: TunerMode
  gateOpen: boolean
  signal: 'waiting' | 'active' | 'holding'
  reading: TunerReading | null
  tune: { status: TuneStatus; since: number | null; exitSince: number | null }
  noisyHint: boolean
  // 內部（測試可讀，UI 不應依賴）
  /** 最近 pitched 估計（MIDI 浮點） */
  recent: number[]
  median: number[]
  smoothedMidi: number | null
  autoCandidate: { stringIndex: number; count: number; since: number } | null
  unclearSince: number | null
}

export type TunerEvent =
  | { type: 'frame'; analysis: FrameAnalysis; now: number }
  | { type: 'setMode'; mode: TunerMode; now: number }
  /** 參考音播放、暫停、停止 */
  | { type: 'suspend' }

const TRACKING = Object.freeze({ status: 'tracking' as const, since: null, exitSince: null })

export function createInitialTunerState(mode: TunerMode = AUTO_MODE): TunerState {
  return {
    mode,
    gateOpen: false,
    signal: 'waiting',
    reading: null,
    tune: TRACKING,
    noisyHint: false,
    recent: [],
    median: [],
    smoothedMidi: null,
    autoCandidate: null,
    unclearSince: null,
  }
}

/** 對稱捨入（Math.round(-5.5) === -5 會讓 ±5 邊界不對稱），並把 -0 正規化為 0 */
export function roundHalfAwayFromZero(x: number): number {
  const r = Math.sign(x) * Math.round(Math.abs(x))
  return r === 0 ? 0 : r
}

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** 回到等待中：保留 mode、閘門與吵雜提示計時 */
function toWaiting(state: TunerState): TunerState {
  return {
    ...createInitialTunerState(state.mode),
    gateOpen: state.gateOpen,
    noisyHint: state.noisyHint,
    unclearSince: state.unclearSince,
  }
}

/** 非有效讀數的幀：保留顯示 holdMs 後回到等待中（TUN-34/35） */
function holdOrExpire(state: TunerState, now: number, p: TunerParams): TunerState {
  if (!state.reading) return state.signal === 'waiting' ? state : { ...state, signal: 'waiting' }
  if (now - state.reading.at >= p.holdMs) return toWaiting(state)
  return { ...state, signal: 'holding' }
}

function nextTune(prev: TunerState['tune'], displayCents: number, now: number, prevAt: number | null, p: TunerParams): TunerState['tune'] {
  const d = Math.abs(displayCents)
  switch (prev.status) {
    case 'tracking':
      return d <= p.inTuneEnterCents ? { status: 'approaching', since: now, exitSince: null } : prev
    case 'approaching': {
      if (d > p.inTuneEnterCents) return TRACKING
      // 讀數中斷太久就重新計時
      const since = prev.since === null || prevAt === null || now - prevAt > p.inTuneMaxGapMs ? now : prev.since
      if (now - since >= p.inTuneEnterMs) return { status: 'inTune', since, exitSince: null }
      return since === prev.since ? prev : { status: 'approaching', since, exitSince: null }
    }
    case 'inTune': {
      if (d <= p.inTuneExitCents) return prev.exitSince === null ? prev : { ...prev, exitSince: null }
      // 與進入對稱：讀數中斷太久就重新計時（TUN-31「持續」）
      const gap = prevAt === null || now - prevAt > p.inTuneMaxGapMs
      const exitSince = prev.exitSince === null || gap ? now : prev.exitSince
      if (now - exitSince >= p.inTuneExitMs) return TRACKING
      return { ...prev, exitSince }
    }
  }
}

function onFrame(state: TunerState, analysis: FrameAnalysis, now: number, p: TunerParams): TunerState {
  const gateOpen = analysis.kind !== 'silent'

  // 1. 穩定性（TUN-34）
  let recent: number[]
  if (analysis.kind === 'pitched') {
    recent = [...state.recent, frequencyToMidi(analysis.freq)]
    if (recent.length > p.stabilityCount) recent = recent.slice(recent.length - p.stabilityCount)
  }
  else {
    recent = []
  }
  const stable = analysis.kind === 'pitched'
    && recent.length >= p.stabilityCount
    && (Math.max(...recent) - Math.min(...recent)) * 100 <= p.stabilityMaxSpreadCents

  // 吵雜提示（TUN-36）：閘門開但沒有有效讀數的連續時間
  const unclearSince = stable || !gateOpen ? null : (state.unclearSince ?? now)
  const noisyHint = unclearSince !== null && now - unclearSince > p.noisyHintMs

  if (!stable) return holdOrExpire({ ...state, gateOpen, recent, unclearSince, noisyHint }, now, p)

  // 2. 目標弦（TUN-10/11/12）
  let stringIndex: number
  let autoCandidate = state.autoCandidate
  if (state.mode.kind === 'manual') {
    stringIndex = state.mode.stringIndex
    autoCandidate = null
  }
  else {
    // 以本次原始估計判斷最近弦；切換需同一候選連續 ≥ 3 個有效讀數且 ≥ 100 ms
    const nearest = nearestStringIndex(analysis.freq)
    const current = state.reading?.stringIndex
    if (current === undefined) {
      stringIndex = nearest
      autoCandidate = null
    }
    else if (nearest === current) {
      stringIndex = current
      autoCandidate = null
    }
    else {
      const cand = autoCandidate?.stringIndex === nearest
        ? { ...autoCandidate, count: autoCandidate.count + 1 }
        : { stringIndex: nearest, count: 1, since: now }
      if (cand.count >= p.autoSwitchCount && now - cand.since >= p.autoSwitchMinMs) {
        stringIndex = nearest
        autoCandidate = null
      }
      else {
        // 候選未確認前不更新讀數：新音對舊弦算出的 cents 會顯示成「舊弦 +500 ¢」甚至沿用「準了」
        return holdOrExpire({ ...state, gateOpen, recent, unclearSince, noisyHint, autoCandidate: cand }, now, p)
      }
    }
  }

  // 3. 平滑（TUN-38），在 MIDI 浮點域：中位數 + 時間常數 EMA；跳動過大直接重置
  const raw = recent[recent.length - 1]!
  const prevAt = state.reading?.at ?? null
  let median: number[]
  let smoothedMidi: number
  if (state.smoothedMidi === null || Math.abs(raw - state.smoothedMidi) * 100 > p.resetJumpCents) {
    median = [raw]
    smoothedMidi = raw
  }
  else {
    median = [...state.median, raw]
    if (median.length > p.medianSize) median = median.slice(median.length - p.medianSize)
    const dt = prevAt === null ? 0 : Math.max(0, now - prevAt)
    const alpha = 1 - Math.exp(-dt / p.emaTimeConstantMs)
    smoothedMidi = state.smoothedMidi + alpha * (medianOf(median) - state.smoothedMidi)
  }

  // 4. 顯示值
  const freq = midiToFrequency(smoothedMidi)
  const cents = centsBetween(freq, TUNER_STRINGS[stringIndex]!.frequency)
  const displayCents = roundHalfAwayFromZero(cents)

  // 5. 「準了」遲滯（TUN-30/31/32）；換弦時重新開始判定
  const stringChanged = state.reading !== null && state.reading.stringIndex !== stringIndex
  const tune = nextTune(stringChanged ? TRACKING : state.tune, displayCents, now, prevAt, p)

  return {
    ...state,
    gateOpen,
    signal: 'active',
    reading: { stringIndex, freq, cents, displayCents, at: now },
    tune,
    noisyHint,
    recent,
    median,
    smoothedMidi,
    autoCandidate,
    unclearSince,
  }
}

export function tunerReducer(state: TunerState, event: TunerEvent, params: TunerParams = TUNER_PARAMS): TunerState {
  switch (event.type) {
    case 'frame':
      return onFrame(state, event.analysis, event.now, params)
    case 'setMode':
      return createInitialTunerState(event.mode)
    case 'suspend':
      return createInitialTunerState(state.mode)
  }
}
