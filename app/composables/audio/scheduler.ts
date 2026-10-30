import { LOOKAHEAD_S, START_DELAY_S, WAKE_INTERVAL_MS } from '~/utils/clock/params'
import { clampBpm } from '~/utils/clock/tempo'
import { changeTempo, createTimeline, planWindow, type Timeline } from '~/utils/clock/timeline'

/**
 * 瀏覽器端 lookahead 排程器（ADR-008、§3.6，無 Vue）。
 * 計時器只負責喚醒並呼叫冪等的 tick()；把時間交給 onStep，發聲由 consumer 以 AudioContext 時間完成。
 * 這是整個 app/ 唯一允許使用 setInterval 的檔案（PA-08，tests/purity.spec.ts 強制），
 * 而且本檔不建立任何音訊節點。
 */

type IntervalHandle = ReturnType<typeof setInterval>

export interface SchedulerOptions {
  ctx: Pick<BaseAudioContext, 'currentTime' | 'state'>
  bpm: number
  /** 節拍器 1；編曲器 2 */
  stepsPerBeat?: number
  /** 在這裡建立節點並以 time 開始發聲 */
  onStep(step: number, time: number): void
  lookaheadS?: number
  wakeIntervalMs?: number
  startDelayS?: number
  timers?: { setInterval: typeof setInterval; clearInterval: typeof clearInterval }
}

export interface SchedulerStats { skippedSteps: number; maxWakeGapMs: number }

export interface Scheduler {
  start(): void
  stop(): void
  tick(): void
  setBpm(bpm: number): void
  readonly bpm: number
  readonly running: boolean
  readonly stats: Readonly<SchedulerStats>
}

export function createScheduler(opts: SchedulerOptions): Scheduler {
  const { ctx, onStep } = opts
  const lookaheadS = opts.lookaheadS ?? LOOKAHEAD_S
  const wakeIntervalMs = opts.wakeIntervalMs ?? WAKE_INTERVAL_MS
  const startDelayS = opts.startDelayS ?? START_DELAY_S
  const stepsPerBeat = opts.stepsPerBeat ?? 1

  let bpm = clampBpm(opts.bpm)
  let timeline: Timeline | null = null
  let handle: IntervalHandle | null = null
  let lastWake: number | null = null
  let warned = false
  const stats: SchedulerStats = { skippedSteps: 0, maxWakeGapMs: 0 }

  function plan(lookahead: number) {
    if (!timeline || ctx.state !== 'running') return // currentTime 不前進時排了也沒意義
    const now = ctx.currentTime
    if (lastWake !== null) stats.maxWakeGapMs = Math.max(stats.maxWakeGapMs, (now - lastWake) * 1000)
    lastWake = now
    const result = planWindow(timeline, now, { lookaheadS: lookahead })
    timeline = result.timeline
    stats.skippedSteps += result.skipped
    for (const { step, time } of result.due) {
      try {
        onStep(step, time)
      }
      catch (error) {
        // consumer 的錯誤不能停掉時鐘
        if (!warned) {
          warned = true
          console.warn('[clock] onStep failed:', error)
        }
      }
    }
  }

  function tick() {
    plan(lookaheadS)
  }

  return {
    start() {
      if (timeline) return
      timeline = createTimeline({ startTime: ctx.currentTime + startDelayS, bpm, stepsPerBeat })
      lastWake = null
      stats.skippedSteps = 0
      stats.maxWakeGapMs = 0
      // 第一次喚醒的視窗涵蓋 startDelay，讓第一拍立即交給音訊執行緒
      plan(startDelayS + lookaheadS)
      const set = opts.timers?.setInterval ?? globalThis.setInterval
      handle = set(tick, wakeIntervalMs)
    },
    stop() {
      if (handle !== null) {
        const clear = opts.timers?.clearInterval ?? globalThis.clearInterval
        clear(handle)
        handle = null
      }
      timeline = null
      lastWake = null
    },
    tick,
    setBpm(next: number) {
      bpm = clampBpm(next, bpm)
      if (timeline) timeline = changeTempo(timeline, bpm, ctx.currentTime)
    },
    get bpm() {
      return bpm
    },
    get running() {
      return timeline !== null
    },
    get stats() {
      return stats
    },
  }
}
