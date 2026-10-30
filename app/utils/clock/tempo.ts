/** 速度換算（純函式，§7.2）。BPM 範圍同時套用於節拍器與日後的編曲器回放 */

export const BPM_MIN = 30
export const BPM_MAX = 200
/** clampBpm 未指定 fallback 時使用 */
export const FALLBACK_BPM = 60

/** 四捨五入成整數並夾在 [BPM_MIN, BPM_MAX]；非有限數回傳 fallback（fallback 本身也會被夾限） */
export function clampBpm(bpm: number, fallback: number = FALLBACK_BPM): number {
  const value = Number.isFinite(bpm) ? bpm : (Number.isFinite(fallback) ? fallback : FALLBACK_BPM)
  return Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(value)))
}

/** 一步的秒數：60 / bpm / stepsPerBeat */
export function secondsPerStep(bpm: number, stepsPerBeat: number): number {
  return 60 / bpm / stepsPerBeat
}
