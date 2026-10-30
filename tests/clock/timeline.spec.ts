import { describe, expect, it } from 'vitest'
import { changeTempo, createTimeline, planWindow, stepTime, type ScheduledStep, type Timeline } from '~/utils/clock/timeline'
import { mulberry32 } from '../helpers/prng'

/** 時間序列驅動：依喚醒時間序列呼叫 planWindow，收集交出的步 */
function drive(tl: Timeline, wakes: Iterable<number>) {
  const due: ScheduledStep[] = []
  let skipped = 0
  for (const now of wakes) {
    const r = planWindow(tl, now)
    tl = r.timeline
    due.push(...r.due)
    skipped += r.skipped
  }
  return { tl, due, skipped }
}

function* every(from: number, to: number, stepS: number) {
  // 以整數索引產生喚醒時間，避免測試本身累加浮點數
  for (let i = 0; from + i * stepS <= to; i++) yield from + i * stepS
}

describe('timeline: no drift (§9.3 #1, #2)', () => {
  // 門檻 1e-12：正確實作（一次乘法）與預期值完全相等；改成累加時 97 BPM 一小時會偏約 5e-10，會被抓到
  it('60 BPM for 1 hour with 25 ms wakes: steps 0..3600 contiguous, each |time − (1 + n)| < 1e-12', () => {
    const { due, skipped } = drive(createTimeline({ startTime: 1, bpm: 60 }), every(0, 3601, 0.025))
    expect(skipped).toBe(0)
    expect(due.length).toBeGreaterThanOrEqual(3601)
    due.forEach((d, i) => {
      expect(d.step).toBe(i)
      expect(Math.abs(d.time - (1 + i))).toBeLessThan(1e-12)
    })
  })

  it('97 BPM (non-representable beat length) for 1 hour: no accumulated error (< 1e-12)', () => {
    const spb = 60 / 97
    const { due, skipped } = drive(createTimeline({ startTime: 0.5, bpm: 97 }), every(0, 3600, 0.025))
    expect(skipped).toBe(0)
    expect(due.length).toBeGreaterThan(5800)
    due.forEach((d, i) => {
      expect(d.step).toBe(i)
      expect(Math.abs(d.time - (0.5 + i * spb))).toBeLessThan(1e-12)
    })
  })

  it('200 BPM for 2 hours with jittered wakes (25 ms + 0–60 ms, fixed seed): on grid, nothing skipped', () => {
    const rand = mulberry32(42)
    const start = 0.5
    function* jittered() {
      let now = 0
      while (now < 7200) {
        yield now
        now += 0.025 + rand() * 0.06
      }
    }
    const { due, skipped } = drive(createTimeline({ startTime: start, bpm: 200 }), jittered())
    expect(skipped).toBe(0)
    expect(due.length).toBeGreaterThan(23_990)
    due.forEach((d, i) => {
      expect(d.step).toBe(i)
      expect(Math.abs(d.time - (start + i * 0.3))).toBeLessThan(1e-12)
    })
  })
})

describe('timeline: window semantics (§9.3 #3, #4)', () => {
  it('horizon is strict: step n is not due at stepTime(n) − 0.1, but is 1 µs later', () => {
    let tl = createTimeline({ startTime: 1, bpm: 60 })
    tl = planWindow(tl, 1.5).timeline // 交出步 0
    const t1 = stepTime(tl, 1)
    expect(planWindow(tl, t1 - 0.1).due).toEqual([])
    expect(planWindow(tl, t1 - 0.1 + 1e-6).due.map(d => d.step)).toEqual([1])
  })

  it('the same step is never handed out twice for overlapping windows', () => {
    let tl = createTimeline({ startTime: 0.05, bpm: 120 })
    const first = planWindow(tl, 0)
    expect(first.due.map(d => d.step)).toEqual([0])
    tl = first.timeline
    const again = planWindow(tl, 0)
    expect(again.due).toEqual([])
    expect(again.timeline).toBe(tl)
  })
})

describe('timeline: tempo changes (§9.3 #5–#8)', () => {
  it('60→120 between beats: scheduled step 3 stays, step 4 = 4.5, step 5 = 5.0', () => {
    let tl = createTimeline({ startTime: 1, bpm: 60 })
    tl = planWindow(tl, 3.95).timeline // 交出 0..3（time 1..4）
    expect(tl.lastScheduled).toEqual({ step: 3, time: 4 })
    tl = changeTempo(tl, 120, 3.95)
    expect(stepTime(tl, 4)).toBeCloseTo(4.5, 12)
    expect(stepTime(tl, 5)).toBeCloseTo(5.0, 12)
    const { due } = drive(tl, every(3.975, 5.45, 0.025))
    expect(due.map(d => d.step)).toEqual([4, 5, 6])
    expect(due[0]!.time).toBeCloseTo(4.5, 12)
    expect(due[2]!.time).toBeCloseTo(5.5, 12)
  })

  it('changing tempo before the first beat keeps the first beat time; later spacing uses the new tempo', () => {
    let tl = createTimeline({ startTime: 0.1, bpm: 60 })
    tl = changeTempo(tl, 120, 0)
    const { due } = drive(tl, every(0, 2, 0.025))
    expect(due[0]).toEqual({ step: 0, time: 0.1 })
    expect(due[1]!.time - due[0]!.time).toBeCloseTo(0.5, 12)
  })

  it('slow → fast respects MIN_LEAD_S: next beat at now + 0.02, then 0.3 s spacing', () => {
    let tl = createTimeline({ startTime: 0, bpm: 30 })
    tl = planWindow(tl, 0).timeline // 步 0 @ 0
    const now = 1.5
    tl = changeTempo(tl, 200, now)
    const { due, skipped } = drive(tl, every(now, now + 1, 0.025))
    expect(skipped).toBe(0)
    expect(due[0]!.step).toBe(1)
    expect(due[0]!.time).toBeCloseTo(now + 0.02, 12)
    expect(due[1]!.time - due[0]!.time).toBeCloseTo(0.3, 12)
  })

  // 預期值獨立於實作的錨點公式：只用「換速度的時間點」與「新的拍長」推出每一拍該在哪裡
  it('10 consecutive tempo changes: first beat after each change and the spacing within each segment', () => {
    let tl = createTimeline({ startTime: 0.1, bpm: 60 })
    const tempos = [72, 95, 40, 200, 31, 123, 88, 150, 66, 99]
    const segments: { bpm: number; changeAt: number; due: ScheduledStep[] }[] = []
    let i = 0
    for (const bpm of [60, ...tempos]) {
      const changeAt = i * 0.025
      if (segments.length) tl = changeTempo(tl, bpm, changeAt)
      const seg = { bpm, changeAt, due: [] as ScheduledStep[] }
      segments.push(seg)
      for (const end = i + 292; i < end; i++) { // 每段約 7.3 s
        const r = planWindow(tl, i * 0.025)
        tl = r.timeline
        seg.due.push(...r.due)
      }
    }
    const all = segments.flatMap(s => s.due)
    expect(all.length).toBeGreaterThan(50)
    all.forEach((d, n) => expect(d.step).toBe(n))
    segments.forEach((seg, k) => {
      const spb = 60 / seg.bpm
      for (let j = 1; j < seg.due.length; j++) {
        expect(Math.abs(seg.due[j]!.time - seg.due[j - 1]!.time - spb), `segment ${k}`).toBeLessThan(1e-9)
      }
      const prevLast = segments.slice(0, k).flatMap(s => s.due).at(-1)
      if (k > 0 && prevLast && seg.due[0]) {
        const expected = Math.max(prevLast.time + spb, seg.changeAt + 0.02)
        expect(Math.abs(seg.due[0].time - expected), `segment ${k} first beat`).toBeLessThan(1e-9)
      }
    })
  })
})

describe('timeline: late wakes skip, never catch up (§9.3 #9–#11)', () => {
  it('1.3 s timer delay at 120 BPM: skipped by grid, next due stays on the grid and is not late', () => {
    const start = 0.1
    let tl = createTimeline({ startTime: start, bpm: 120 })
    tl = drive(tl, every(0, 1, 0.025)).tl // 正常播放到 1 s
    const lastBefore = tl.lastScheduled!
    const now = 1 + 1.3
    const r = planWindow(tl, now)
    // 過期的步：time < now − 0.01
    const firstOk = Math.ceil((now - 0.01 - start) / 0.5)
    expect(r.skipped).toBe(firstOk - (lastBefore.step + 1))
    expect(r.skipped).toBeGreaterThanOrEqual(2)
    const next = r.due[0] ?? { time: stepTime(r.timeline, r.timeline.nextStep), step: r.timeline.nextStep }
    const k = (next.time - start) / 0.5
    expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9)
    expect(next.time).toBeGreaterThanOrEqual(now - 0.01)
    for (const d of r.due) expect(d.time).toBeGreaterThanOrEqual(now - 0.01)
  })

  it('within tolerance: a step 5 ms late is still due; 20 ms late is skipped', () => {
    const tl = createTimeline({ startTime: 10, bpm: 60 })
    expect(planWindow(tl, 10.005).due.map(d => d.step)).toEqual([0])
    const late = planWindow(tl, 10.02)
    expect(late.skipped).toBe(1)
    expect(late.due).toEqual([])
    expect(late.timeline.nextStep).toBe(1)
  })

  it('a pause of ~1e6 s is skipped in O(1)', () => {
    let tl = createTimeline({ startTime: 0.1, bpm: 120 })
    tl = planWindow(tl, 0.05).timeline
    expect(tl.nextStep).toBe(1)
    const t0 = performance.now()
    const r = planWindow(tl, 1e6)
    const elapsed = performance.now() - t0
    expect(elapsed).toBeLessThan(5) // 單次呼叫；逐拍迴圈需要兩百萬次
    expect(r.skipped).toBe(Math.ceil((1e6 - 0.01 - 0.1) / 0.5) - 1)
    for (const d of r.due) expect(d.time).toBeGreaterThanOrEqual(1e6 - 0.01)
  })

  it('a skip without any due step followed by a tempo change keeps spacing from the last played step', () => {
    let tl = createTimeline({ startTime: 0, bpm: 60 })
    tl = planWindow(tl, 0).timeline // 步 0 @ 0
    tl = planWindow(tl, 1.05).timeline // 步 1 @ 1 過期，跳過；步 2 @ 2 未進視窗
    expect(tl.nextStep).toBe(2)
    tl = changeTempo(tl, 120, 1.05)
    expect(tl.anchor.step).toBe(2)
    expect(tl.anchor.time).toBeCloseTo(1.07, 9) // max(0 + 0.5, now + 0.02)
  })

  // code review #1：舊公式 prev.time + k × 新拍長 會把跳過的 k 步放大成數十秒的靜音
  it('a stall at 200 BPM that hands out nothing, then 200 → 30: next beat is one new beat after the last played one', () => {
    let tl = createTimeline({ startTime: 0, bpm: 200 })
    tl = planWindow(tl, 0).timeline // 步 0 @ 0
    const now = 1.09
    const r = planWindow(tl, now) // 步 1–3 過期跳過；步 4 @ 1.2 尚未進入視窗
    expect(r.skipped).toBe(3)
    expect(r.due).toEqual([])
    tl = changeTempo(r.timeline, 30, now)
    const next = stepTime(tl, tl.nextStep)
    expect(next).toBeLessThanOrEqual(now + 2.0)
    expect(next).toBeCloseTo(2.0, 12) // max(0 + 2.0, now + 0.02)
  })

  it('tempo change before anything was handed out but after a skip keeps the old grid position', () => {
    let tl = createTimeline({ startTime: 0.1, bpm: 120 })
    tl = planWindow(tl, 0.5).timeline // 步 0 @ 0.1 過期跳過；步 1 @ 0.6 尚未進入視窗
    expect(tl.lastScheduled).toBeNull()
    expect(tl.nextStep).toBe(1)
    tl = changeTempo(tl, 60, 0.5)
    expect(stepTime(tl, 1)).toBeCloseTo(0.6, 12) // 舊格線位置，不是 0.1 + 1 × 1.0
    expect(stepTime(tl, 2)).toBeCloseTo(1.6, 12)
  })
})

describe('timeline: stepsPerBeat (§9.3 #12)', () => {
  it('120 BPM with stepsPerBeat = 2 spaces steps by 0.25 s', () => {
    const { due } = drive(createTimeline({ startTime: 0, bpm: 120, stepsPerBeat: 2 }), every(0, 2, 0.025))
    for (let i = 1; i < due.length; i++) expect(due[i]!.time - due[i - 1]!.time).toBeCloseTo(0.25, 12)
    expect(due.length).toBeGreaterThanOrEqual(8)
  })
})
