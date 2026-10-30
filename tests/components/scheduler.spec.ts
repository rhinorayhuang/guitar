// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createScheduler, type Scheduler, type SchedulerOptions } from '~/composables/audio/scheduler'
import { FakeAudioContext } from '../helpers/fakeAudio'

let ctx: FakeAudioContext
let calls: { step: number; time: number }[]
let scheduler: Scheduler | null = null

function make(opts: Partial<SchedulerOptions> = {}): Scheduler {
  scheduler = createScheduler({
    ctx: ctx as unknown as SchedulerOptions['ctx'],
    bpm: 60,
    onStep: (step, time) => calls.push({ step, time }),
    ...opts,
  })
  return scheduler
}

/** 每 25 ms：音訊時間前進並觸發一次計時器 */
function run(seconds: number) {
  const n = Math.round(seconds / 0.025)
  for (let i = 0; i < n; i++) {
    ctx.advance(0.025)
    vi.advanceTimersByTime(25)
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  ctx = new FakeAudioContext()
  ctx.state = 'running'
  ctx.currentTime = 3
  calls = []
})

afterEach(() => {
  scheduler?.stop()
  scheduler = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('scheduler (§9.4)', () => {
  it('start() schedules the first beat immediately at currentTime + 0.1', () => {
    make().start()
    expect(calls).toEqual([{ step: 0, time: 3.1 }])
    expect(vi.getTimerCount()).toBe(1)
  })

  it('60 BPM for 30 s: intervals all exactly 1.000, no duplicate steps', () => {
    make().start()
    run(30)
    expect(calls.length).toBeGreaterThanOrEqual(30)
    calls.forEach((c, i) => expect(c.step).toBe(i))
    for (let i = 1; i < calls.length; i++) expect(Math.abs(calls[i]!.time - calls[i - 1]!.time - 1)).toBeLessThan(1e-9)
  })

  it('timer delay: no late onStep, skipped steps counted, wake gap recorded', () => {
    const s = make()
    s.start()
    run(1)
    const before = calls.length
    ctx.advance(2) // 計時器被凍結 2 s
    vi.advanceTimersByTime(25)
    const late = calls.slice(before).filter(c => c.time < ctx.currentTime - 0.01)
    expect(late).toEqual([])
    expect(s.stats.skippedSteps).toBeGreaterThan(0)
    expect(s.stats.maxWakeGapMs).toBeGreaterThanOrEqual(2000)
  })

  it('extra tick() calls (rAF) never duplicate steps', () => {
    const s = make()
    s.start()
    for (let i = 0; i < 200; i++) {
      ctx.advance(0.0125)
      s.tick()
      s.tick()
      if (i % 2) vi.advanceTimersByTime(25)
    }
    calls.forEach((c, i) => expect(c.step).toBe(i))
  })

  it('setBpm while running: the next unscheduled step uses the new spacing', () => {
    const s = make()
    s.start()
    run(2.05)
    const scheduledBefore = calls.length
    s.setBpm(120)
    expect(s.bpm).toBe(120)
    run(3)
    const after = calls.slice(scheduledBefore - 1)
    expect(after.length).toBeGreaterThan(3)
    for (let i = 1; i < after.length; i++) expect(after[i]!.time - after[i - 1]!.time).toBeCloseTo(0.5, 9)
  })

  it('setBpm clamps and works while stopped', () => {
    const s = make()
    s.setBpm(500)
    expect(s.bpm).toBe(200)
    s.setBpm(Number.NaN)
    expect(s.bpm).toBe(200)
  })

  it('stop() clears the interval and later ticks schedule nothing; stop is idempotent', () => {
    const s = make()
    s.start()
    expect(s.running).toBe(true)
    s.stop()
    s.stop()
    expect(s.running).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    const n = calls.length
    ctx.advance(5)
    s.tick()
    expect(calls.length).toBe(n)
  })

  it('does not schedule while the context is not running', () => {
    ctx.state = 'suspended'
    const s = make()
    s.start()
    run(2)
    expect(calls).toEqual([])
    ctx.state = 'running'
    s.tick()
    expect(calls.length).toBeGreaterThan(0)
  })

  it('an onStep exception does not stop the clock (warns once)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let n = 0
    make({
      onStep: (step, time) => {
        n++
        calls.push({ step, time })
        throw new Error('boom')
      },
    }).start()
    run(5)
    expect(n).toBeGreaterThanOrEqual(5)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('accepts injected timers', () => {
    const setI = vi.fn(() => 7 as unknown as ReturnType<typeof setInterval>)
    const clearI = vi.fn()
    const s = make({ timers: { setInterval: setI as unknown as typeof setInterval, clearInterval: clearI as unknown as typeof clearInterval } })
    s.start()
    expect(setI).toHaveBeenCalledWith(expect.any(Function), 25)
    s.stop()
    expect(clearI).toHaveBeenCalledWith(7)
  })

  it('stepsPerBeat = 2 gives eighth-note steps', () => {
    make({ bpm: 120, stepsPerBeat: 2 }).start()
    run(2)
    for (let i = 1; i < calls.length; i++) expect(calls[i]!.time - calls[i - 1]!.time).toBeCloseTo(0.25, 9)
  })
})
