import { describe, expect, it } from 'vitest'
import { beatOf } from '~/utils/metronome/beats'
import { clickPlan } from '~/utils/metronome/clickPlan'
import { BPM_MAX, secondsPerStep } from '~/utils/clock/tempo'

describe('beatOf', () => {
  it.each([
    [0, 0, true], [3, 3, false], [4, 0, true], [4001, 1, false],
  ])('beatOf(%d) = { %d, %s }', (step, beatInBar, accent) => {
    expect(beatOf(step)).toEqual({ beatInBar, accent })
  })

  it('handles other bar lengths and negative steps', () => {
    expect(beatOf(5, 3)).toEqual({ beatInBar: 2, accent: false })
    expect(beatOf(-1)).toEqual({ beatInBar: 3, accent: false })
  })
})

describe('clickPlan (ADR-010)', () => {
  const accent = clickPlan(true)
  const normal = clickPlan(false)

  it('accent is higher and louder than a normal beat', () => {
    expect(accent.frequency).toBeGreaterThan(normal.frequency)
    expect(accent.peakGain).toBeGreaterThan(normal.peakGain)
  })

  it('envelope is short and never overlaps the next beat at the fastest tempo', () => {
    for (const p of [accent, normal]) {
      expect(p.attackS).toBeLessThan(p.durationS)
      expect(p.durationS).toBeLessThanOrEqual(0.1)
      expect(p.durationS).toBeLessThan(secondsPerStep(BPM_MAX, 1))
      expect(p.peakGain).toBeGreaterThan(0)
      expect(p.peakGain).toBeLessThanOrEqual(1)
    }
  })

  it('returns a fresh object (callers may not mutate the params)', () => {
    expect(clickPlan(true)).not.toBe(clickPlan(true))
  })
})
