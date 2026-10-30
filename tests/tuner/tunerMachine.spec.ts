import { describe, expect, it } from 'vitest'
import { createInitialTunerState, roundHalfAwayFromZero, tunerReducer } from '~/utils/tuner/tunerMachine'
import { Driver, atCents, pitched, silent, unclear } from '../helpers/frames'

/** 關掉平滑，只驗證「準了」遲滯邏輯（displayCents = 原始值捨入） */
const NO_SMOOTHING = { medianSize: 1, emaTimeConstantMs: 1e-9 }
const A2 = 1

/** 先餵到有讀數為止（穩定性需 3 筆） */
function primed(cents: number, opts: { mode?: ConstructorParameters<typeof Driver>[0]; dt?: number } = {}) {
  const d = new Driver(opts.mode, NO_SMOOTHING)
  for (let i = 0; i < 3; i++) d.feed(pitched(atCents(A2, cents)), opts.dt ?? 10)
  expect(d.state.reading).not.toBeNull()
  return d
}

describe('TUN-34: stability and unclear frames', () => {
  it('3 estimates spread by 30 cents produce no reading; consistent ones do', () => {
    const d = new Driver()
    d.feed(pitched(atCents(A2, 0)))
    d.feed(pitched(atCents(A2, 30)))
    expect(d.feed(pitched(atCents(A2, 0))).reading).toBeNull()
    expect(d.feed(pitched(atCents(A2, 0))).reading).toBeNull() // [30, 0, 0] 仍不穩定
    const s = d.feed(pitched(atCents(A2, 0)))
    expect(s.reading?.stringIndex).toBe(A2)
    expect(s.reading?.displayCents).toBe(0)
  })

  it('needs exactly 3 consistent estimates for the first reading', () => {
    const d = new Driver()
    expect(d.feed(pitched(110)).reading).toBeNull()
    expect(d.feed(pitched(110)).reading).toBeNull()
    expect(d.feed(pitched(110)).reading).not.toBeNull()
  })

  it('unclear frames after a reading keep the reading unchanged', () => {
    const d = new Driver()
    d.repeat(pitched(atCents(A2, -12)), 100)
    const reading = d.state.reading
    for (let i = 0; i < 5; i++) {
      const s = d.feed(unclear())
      expect(s.reading).toBe(reading)
      expect(s.signal).toBe('holding')
    }
  })

  it('a non-pitched frame clears the stability buffer', () => {
    const d = new Driver()
    d.feed(pitched(110))
    d.feed(pitched(110))
    d.feed(unclear())
    expect(d.state.recent).toEqual([])
    expect(d.feed(pitched(110)).reading).toBeNull()
  })
})

describe('TUN-10/11/12: target string selection', () => {
  it('adopts the nearest string immediately from waiting', () => {
    const d = new Driver()
    d.repeat(pitched(220), 50)
    expect(d.state.reading?.stringIndex).toBe(3)
  })

  it('does not switch while readings alternate across the E2/A2 boundary, then switches after ≥3 readings and ≥100 ms', () => {
    const d = new Driver()
    const seq = [95.0, 95.3, 95.0, 95.4]
    const states = d.repeat(i => pitched(seq[i % 4]!), 2000)
    const withReading = states.filter(([, s]) => s.reading)
    expect(withReading.length).toBeGreaterThan(100)
    for (const [, s] of withReading) expect(s.reading!.stringIndex).toBe(0)

    const after = d.repeat(pitched(96.5), 300)
    const switchIdx = after.findIndex(([, s]) => s.reading?.stringIndex === 1)
    expect(switchIdx).toBeGreaterThan(0)
    const [tSwitch] = after[switchIdx]!
    // 候選可能從交替序列最後一筆 95.4（同樣指向 A2）就開始累積，因此以候選本身的 since 計時
    const tCand = after[switchIdx - 1]![1].autoCandidate!.since
    expect(tSwitch - tCand).toBeGreaterThanOrEqual(100)
    expect(tSwitch - tCand).toBeLessThan(100 + 2 * 1000 / 60)
    // 切換前候選至少累積 3 筆
    const candidateCounts = after.filter(([t]) => t < tSwitch).map(([, s]) => s.autoCandidate?.count ?? 0)
    expect(Math.max(...candidateCounts)).toBeGreaterThanOrEqual(3)
    expect(after.at(-1)![1].reading!.stringIndex).toBe(1)
  })

  it('a reading that returns to the current string clears the candidate', () => {
    const d = new Driver()
    d.repeat(pitched(94), 100)
    d.repeat(pitched(96.4), 50)
    expect(d.state.autoCandidate?.stringIndex).toBe(1)
    d.repeat(pitched(94), 100)
    expect(d.state.autoCandidate).toBeNull()
    expect(d.state.reading!.stringIndex).toBe(0)
  })

  it('manual mode (A2) always measures against A2', () => {
    const d = new Driver({ kind: 'manual', stringIndex: A2 })
    d.repeat(pitched(82), 200)
    expect(d.state.reading!.stringIndex).toBe(A2)
    expect(d.state.reading!.cents).toBeCloseTo(-508.6, 1)
    expect(d.state.reading!.displayCents).toBe(-509)
  })

  it('setMode resets to waiting with the new mode', () => {
    const d = new Driver()
    d.repeat(pitched(110), 100)
    const s = tunerReducer(d.state, { type: 'setMode', mode: { kind: 'manual', stringIndex: 2 }, now: d.now })
    expect(s.reading).toBeNull()
    expect(s.mode).toEqual({ kind: 'manual', stringIndex: 2 })
  })
})

describe('TUN-30/31/32: in-tune hysteresis', () => {
  it('constant +4: approaching for 0–499 ms, inTune from 500 ms', () => {
    const d = primed(4)
    const t0 = d.state.reading!.at
    for (const [t, s] of d.repeat(pitched(atCents(A2, 4)), 700, 10)) {
      expect(s.reading!.displayCents).toBe(4)
      expect(s.tune.status, `t=${t - t0}`).toBe(t - t0 >= 500 ? 'inTune' : 'approaching')
    }
  })

  it('a single +6 while timing restarts the timer', () => {
    const d = primed(5)
    d.repeat(pitched(atCents(A2, 5)), 300, 10)
    expect(d.state.tune.status).toBe('approaching')
    expect(d.feed(pitched(atCents(A2, 6)), 10).tune.status).toBe('tracking')
    const restart = d.now
    const states = d.repeat(pitched(atCents(A2, 5)), 600, 10)
    for (const [t, s] of states) expect(s.tune.status, `t=${t - restart}`).toBe(t - restart >= 500 ? 'inTune' : 'approaching')
  })

  it('timing restarts after a gap of > 200 ms without readings', () => {
    const d = primed(3)
    d.repeat(pitched(atCents(A2, 3)), 300, 10)
    d.repeat(unclear(), 250, 10)
    const resume = d.now
    d.repeat(pitched(atCents(A2, 3)), 450, 10)
    expect(d.state.tune.status).toBe('approaching')
    // unclear 幀清空穩定性緩衝，恢復後第 3 筆（+20 ms）才是有效讀數
    expect(d.state.tune.since).toBe(resume + 20)
  })

  function inTuneDriver() {
    const d = primed(0)
    d.repeat(pitched(atCents(A2, 0)), 520, 10)
    expect(d.state.tune.status).toBe('inTune')
    return d
  }

  it('stays inTune at +7 for 1 s (hysteresis band)', () => {
    const d = inTuneDriver()
    for (const [, s] of d.repeat(pitched(atCents(A2, 7)), 1000, 10)) expect(s.tune.status).toBe('inTune')
  })

  it('+8 for 190 ms then +3 stays inTune; +8 for 200 ms exits', () => {
    const d = inTuneDriver()
    for (const [, s] of d.repeat(pitched(atCents(A2, 8)), 190, 10)) expect(s.tune.status).toBe('inTune')
    expect(d.feed(pitched(atCents(A2, 3)), 10).tune.status).toBe('inTune')
    expect(d.state.tune.exitSince).toBeNull()

    const start = d.now
    const states = d.repeat(pitched(atCents(A2, 8)), 210, 10)
    for (const [t, s] of states) expect(s.tune.status, `t=${t - start}`).toBe(t - start >= 200 ? 'tracking' : 'inTune')
  })

  it('at 30 fps an occasional unclear frame does not prevent reaching inTune', () => {
    const d = new Driver(undefined, NO_SMOOTHING)
    const dt = 1000 / 30
    // 每 200 ms（6 幀）一個 unclear 幀
    d.repeat(i => (i % 6 === 5 ? unclear() : pitched(atCents(A2, 2))), 2000, dt)
    expect(d.state.tune.status).toBe('inTune')
  })

  it('exit timing restarts after a gap without readings (symmetric with entry)', () => {
    const d = inTuneDriver()
    d.feed(pitched(atCents(A2, 9)), 10)
    expect(d.state.tune.exitSince).not.toBeNull()
    d.repeat(unclear(), 250, 10)
    // 恢復後第 3 筆才是有效讀數；斷訊 > 200 ms，退出計時從這裡重新開始
    d.repeat(pitched(atCents(A2, 9)), 30, 10)
    expect(d.state.tune.status).toBe('inTune')
    expect(d.state.tune.exitSince).toBe(d.state.reading!.at)
  })

  it('while an auto-switch candidate is pending, the old string never shows the new note', () => {
    const d = new Driver()
    d.repeat(pitched(atCents(0, 0)), 700)
    expect(d.state.tune.status).toBe('inTune')
    for (const [, s] of d.repeat(pitched(atCents(A2, 0)), 400)) {
      expect(Math.abs(s.reading!.displayCents)).toBeLessThanOrEqual(250)
      if (s.tune.status === 'inTune') expect(Math.abs(s.reading!.displayCents)).toBeLessThanOrEqual(7)
    }
    expect(d.state.reading!.stringIndex).toBe(A2)
  })

  it('switching string restarts in-tune judgement', () => {
    const d = new Driver(undefined, NO_SMOOTHING)
    d.repeat(pitched(atCents(0, 0)), 600, 10)
    expect(d.state.tune.status).toBe('inTune')
    d.repeat(pitched(atCents(A2, 0)), 200, 10)
    expect(d.state.reading!.stringIndex).toBe(A2)
    expect(d.state.tune.status).toBe('approaching')
  })
})

describe('TUN-31/35: hold after signal loss', () => {
  it('silence keeps inTune for 1.5 s as holding, then returns to waiting', () => {
    const d = new Driver(undefined, NO_SMOOTHING)
    d.repeat(pitched(atCents(A2, 1)), 600, 10)
    expect(d.state.tune.status).toBe('inTune')
    const last = d.state.reading!.at
    for (const [t, s] of d.repeat(silent(), 1600, 10)) {
      if (t - last < 1500) {
        expect(s.signal).toBe('holding')
        expect(s.tune.status).toBe('inTune')
      }
      else {
        expect(s.signal).toBe('waiting')
        expect(s.reading).toBeNull()
        expect(s.tune.status).toBe('tracking')
        expect(s.smoothedMidi).toBeNull()
      }
    }
  })

  it('persistent unclear also returns to waiting after 1.5 s', () => {
    const d = new Driver()
    d.repeat(pitched(110), 100, 10)
    d.repeat(unclear(), 1600, 10)
    expect(d.state.signal).toBe('waiting')
  })
})

describe('TUN-36: noisy hint', () => {
  it('appears after > 2 s of gate-open unclear frames and clears on a valid reading', () => {
    const d = new Driver()
    const states = d.repeat(unclear(), 2020, 10)
    for (const [t, s] of states) expect(s.noisyHint, `t=${t}`).toBe(t > 2000)
    expect(states.find(([t]) => t === 2000)![1].noisyHint).toBe(false)
    expect(states.find(([t]) => t === 2010)![1].noisyHint).toBe(true)
    d.feed(pitched(110), 10)
    d.feed(pitched(110), 10)
    expect(d.feed(pitched(110), 10).noisyHint).toBe(false)
  })

  it('clears when the gate closes', () => {
    const d = new Driver()
    d.repeat(unclear(), 2100, 10)
    expect(d.state.noisyHint).toBe(true)
    expect(d.feed(silent()).noisyHint).toBe(false)
  })
})

describe('TUN-92: suspend', () => {
  it('returns to waiting and keeps the mode', () => {
    const d = new Driver({ kind: 'manual', stringIndex: 4 })
    d.repeat(pitched(247), 100)
    expect(d.state.reading).not.toBeNull()
    const s = tunerReducer(d.state, { type: 'suspend' })
    expect(s).toEqual(createInitialTunerState({ kind: 'manual', stringIndex: 4 }))
  })
})

describe('TUN-30/42: symmetric rounding', () => {
  it('rounds half away from zero and normalises -0', () => {
    expect(roundHalfAwayFromZero(-5.5)).toBe(-6)
    expect(roundHalfAwayFromZero(5.5)).toBe(6)
    expect(roundHalfAwayFromZero(-5.4)).toBe(-5)
    expect(Object.is(roundHalfAwayFromZero(-0.4), 0)).toBe(true)
    expect(Object.is(roundHalfAwayFromZero(-0), 0)).toBe(true)
  })

  it('displayCents −6 (from −5.6) is not "in tune" while +5.4 is', () => {
    const minus = primed(-5.6)
    expect(minus.state.reading!.displayCents).toBe(-6)
    expect(minus.state.tune.status).toBe('tracking')
    const plus = primed(5.4)
    expect(plus.state.reading!.displayCents).toBe(5)
    expect(plus.state.tune.status).toBe('approaching')
  })
})
