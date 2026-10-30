/** 節拍器參數（metronome-architecture.md §4.2、§8.4）。純資料 */

export const BEATS_PER_BAR = 4
export const BPM_STEPS = { fine: 1, coarse: 5 } as const
/** 讀到進度（目前關卡）之前的預設速度 */
export const DEFAULT_BPM = 60

/** Click 音色（ADR-010）。重音同時用較高音高與較大音量區分 */
export const CLICK = {
  accent: { frequency: 1500, type: 'triangle', peakGain: 0.8, attackS: 0.001, durationS: 0.05 },
  normal: { frequency: 1000, type: 'triangle', peakGain: 0.45, attackS: 0.001, durationS: 0.04 },
} as const

/** oscillator 在包絡結束後多播的時間（不在衰減尾端硬切） */
export const CLICK_STOP_PAD_S = 0.005
