/**
 * 播放時鐘參數（metronome-architecture.md §3.3）。數值以本檔為準，文件中的數字是初始值。
 * 純資料：不得 import vue、不碰瀏覽器全域（tests/purity.spec.ts 強制）。
 */

/** 排程器喚醒週期（ms）。要遠小於 LOOKAHEAD_S，讓一次喚醒延遲不會漏拍 */
export const WAKE_INTERVAL_MS = 25
/** 排程視窗（s）：每次喚醒把 time < now + LOOKAHEAD_S 的步交給音訊執行緒 */
export const LOOKAHEAD_S = 0.1
/** 晚到但不超過這個值的步仍照排（Web Audio 會立即播放）；更晚的跳過 */
export const LATE_TOLERANCE_S = 0.01
/** 第一拍 = 開始時的 currentTime + START_DELAY_S */
export const START_DELAY_S = 0.1
/** 改速度時，新的下一拍最早不早於 now + MIN_LEAD_S */
export const MIN_LEAD_S = 0.02
/** 視覺對時採用的輸出延遲上限（防止瀏覽器回報異常值） */
export const MAX_LATENCY_S = 0.5
