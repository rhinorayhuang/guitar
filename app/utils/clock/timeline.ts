import { LATE_TOLERANCE_S, LOOKAHEAD_S, MIN_LEAD_S } from './params'
import { secondsPerStep } from './tempo'

/**
 * 播放時鐘的純函式時間軸（ADR-008、§3.2–3.5）。
 * 任一步的時間 = anchor.time + (step − anchor.step) × 每步秒數，一次乘法算出，不累加浮點數。
 * 全部為不可變更新（回傳新物件）。時間單位為 AudioContext 秒，一律由參數傳入。
 */

export interface TempoAnchor { step: number; time: number; bpm: number }
export interface ScheduledStep { step: number; time: number }

export interface Timeline {
  readonly anchor: TempoAnchor
  readonly stepsPerBeat: number
  /** 下一個要交出的步 */
  readonly nextStep: number
  /** 已排程（已交出）的最後一步；被跳過的步不算 */
  readonly lastScheduled: ScheduledStep | null
}

export interface PlanResult { timeline: Timeline; due: ScheduledStep[]; skipped: number }

export function createTimeline(opts: { startTime: number; bpm: number; stepsPerBeat?: number }): Timeline {
  return {
    anchor: { step: 0, time: opts.startTime, bpm: opts.bpm },
    stepsPerBeat: opts.stepsPerBeat ?? 1,
    nextStep: 0,
    lastScheduled: null,
  }
}

export function stepTime(tl: Timeline, step: number): number {
  const { anchor } = tl
  return anchor.time + (step - anchor.step) * secondsPerStep(anchor.bpm, tl.stepsPerBeat)
}

/**
 * 交出 [now − lateTolerance, now + lookahead) 內尚未交出的步（§3.4）。
 * 過期的步以 O(1) 公式跳過並計數（跳拍不補拍），之後的步仍在原格線上。
 */
export function planWindow(
  tl: Timeline,
  now: number,
  opts: { lookaheadS?: number; lateToleranceS?: number } = {},
): PlanResult {
  const lookahead = opts.lookaheadS ?? LOOKAHEAD_S
  const tolerance = opts.lateToleranceS ?? LATE_TOLERANCE_S
  const limit = now - tolerance
  const horizon = now + lookahead
  const first = tl.nextStep
  let s = first
  let skipped = 0

  if (stepTime(tl, s) < limit) {
    const { anchor } = tl
    const spb = secondsPerStep(anchor.bpm, tl.stepsPerBeat)
    let target = Math.max(s, anchor.step + Math.ceil((limit - anchor.time) / spb))
    // 修正浮點邊界：至多移動一兩步
    while (stepTime(tl, target) < limit) target++
    while (target > s && stepTime(tl, target - 1) >= limit) target--
    skipped = target - s
    s = target
  }

  const due: ScheduledStep[] = []
  for (let t = stepTime(tl, s); t < horizon; t = stepTime(tl, s)) {
    due.push({ step: s, time: t })
    s++
  }

  if (s === first) return { timeline: tl, due, skipped }
  return {
    timeline: { ...tl, nextStep: s, lastScheduled: due.at(-1) ?? tl.lastScheduled },
    due,
    skipped,
  }
}

/**
 * 播放中改速度（§3.5）：下一個尚未排程的步生效，它與前一個已排程步的間隔就是新速度；
 * 已排程的步不改。最早不早於 now + minLead（從很慢改成很快時不會被當成過期跳掉）。
 * 還沒排過也沒跳過任何步時只換 bpm，第一拍時間不變。
 */
export function changeTempo(tl: Timeline, bpm: number, now: number, opts: { minLeadS?: number } = {}): Timeline {
  const prev = tl.lastScheduled
  const minLead = opts.minLeadS ?? MIN_LEAD_S
  if (!prev) {
    if (tl.nextStep === tl.anchor.step) return { ...tl, anchor: { ...tl.anchor, bpm } }
    // 第一次交出前就跳過了步：以舊格線上的下一步為錨點，避免用新速度重新縮放整條格線
    return { ...tl, anchor: { step: tl.nextStep, time: Math.max(stepTime(tl, tl.nextStep), now + minLead), bpm } }
  }
  // 被跳過的步已不存在：只以最後實際排程的步為基準，間隔一個新拍長。
  // 不可乘上 (nextStep − prev.step)，否則卡頓後調慢會被放大成數十秒的靜音（code review #1）
  const time = Math.max(prev.time + secondsPerStep(bpm, tl.stepsPerBeat), now + minLead)
  return { ...tl, anchor: { step: tl.nextStep, time, bpm } }
}
