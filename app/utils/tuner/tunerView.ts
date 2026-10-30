import { tunerCopy } from '~/data/tuner-copy'
import { TUNER_PARAMS, type TunerParams } from './params'
import { TUNER_STRINGS, type TunerString } from './strings'
import { roundHalfAwayFromZero, type TunerState } from './tunerMachine'

export { roundHalfAwayFromZero }

export type TunerStatusKind = 'waiting' | 'tooLow' | 'tooHigh' | 'farLow' | 'farHigh' | 'approaching' | 'inTune'

export interface TunerView {
  status: TunerStatusKind
  /** 目前/所選弦（手動模式時等待中也有值，用於選弦列高亮） */
  string: TunerString | null
  /** 'A'（等待中為 null） */
  noteName: string | null
  /** 'A2' */
  noteLabel: string | null
  /** '第 5 弦' */
  stringLabel: string | null
  /** '−12 ¢'（U+2212）、'+3 ¢'、'0 ¢' */
  centsText: string | null
  /** '109.6 Hz' */
  frequencyText: string | null
  /** −1..1，超出 ±needleRangeCents 固定在端點（TUN-13/14），等待中為 0 */
  needle: number
  directionText: string | null
  isManual: boolean
  noisyHint: boolean
  /** holding 中，供 UI 淡出 */
  fading: boolean
  /** 只隨狀態類別（等待中 / 有讀數 / 準了）改變，給 aria-live（TUN-45） */
  announcement: string
}

const MINUS = '−'

export function formatCents(displayCents: number): string {
  if (displayCents === 0) return '0 ¢'
  return displayCents > 0 ? `+${displayCents} ¢` : `${MINUS}${Math.abs(displayCents)} ¢`
}

export function formatFrequency(freq: number): string {
  return `${freq.toFixed(1)} Hz`
}

export function needlePosition(cents: number, rangeCents: number = TUNER_PARAMS.needleRangeCents): number {
  return Math.max(-1, Math.min(1, cents / rangeCents))
}

export function selectTunerView(state: TunerState, params: TunerParams = TUNER_PARAMS): TunerView {
  const isManual = state.mode.kind === 'manual'
  const reading = state.reading

  if (!reading) {
    const string = state.mode.kind === 'manual' ? TUNER_STRINGS[state.mode.stringIndex]! : null
    return {
      status: 'waiting',
      string,
      noteName: null,
      noteLabel: null,
      stringLabel: null,
      centsText: null,
      frequencyText: null,
      needle: 0,
      directionText: null,
      isManual,
      noisyHint: state.noisyHint,
      fading: false,
      announcement: tunerCopy.waiting,
    }
  }

  const string = TUNER_STRINGS[reading.stringIndex]!
  const d = reading.displayCents
  let status: TunerStatusKind
  if (state.tune.status === 'inTune') status = 'inTune'
  else if (state.tune.status === 'approaching' || Math.abs(d) <= params.inTuneEnterCents) status = 'approaching'
  // TUN-13：「差很多」只用在手動模式；自動模式最多約 ±250 cents，仍用一般方向文字
  else if (d < 0) status = isManual && d < -params.needleRangeCents ? 'farLow' : 'tooLow'
  else status = isManual && d > params.needleRangeCents ? 'farHigh' : 'tooHigh'

  return {
    status,
    string,
    noteName: string.name,
    noteLabel: string.label,
    stringLabel: tunerCopy.stringLabel(string.stringNumber),
    centsText: formatCents(d),
    frequencyText: formatFrequency(reading.freq),
    needle: needlePosition(reading.cents, params.needleRangeCents),
    directionText: tunerCopy.direction[status],
    isManual,
    noisyHint: state.noisyHint,
    fading: state.signal === 'holding',
    announcement: status === 'inTune'
      ? `${string.label} ${tunerCopy.direction.inTune}`
      : tunerCopy.announceReading(string.label, string.stringNumber),
  }
}
