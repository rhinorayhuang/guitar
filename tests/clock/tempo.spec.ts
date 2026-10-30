import { describe, expect, it } from 'vitest'
import { BPM_MAX, BPM_MIN, clampBpm, secondsPerStep } from '~/utils/clock/tempo'

describe('clampBpm (D-M6)', () => {
  it.each([
    [25, 30], [250, 200], [60.4, 60], [60.5, 61], [30, 30], [200, 200], [-10, 30],
  ])('%d → %d', (input, expected) => {
    expect(clampBpm(input)).toBe(expected)
  })

  it('non-finite values return the fallback', () => {
    expect(clampBpm(Number.NaN, 72)).toBe(72)
    expect(clampBpm(Number.POSITIVE_INFINITY, 72)).toBe(72)
    expect(clampBpm(Number.NEGATIVE_INFINITY, 72)).toBe(72)
  })

  it('the fallback is clamped too, and defaults to a valid integer', () => {
    expect(clampBpm(Number.NaN, 999)).toBe(BPM_MAX)
    const d = clampBpm(Number.NaN)
    expect(Number.isInteger(d) && d >= BPM_MIN && d <= BPM_MAX).toBe(true)
  })
})

describe('secondsPerStep', () => {
  it.each([
    [60, 1, 1], [120, 2, 0.25], [200, 1, 0.3],
  ])('(%d, %d) = %d', (bpm, spb, expected) => {
    expect(secondsPerStep(bpm, spb)).toBeCloseTo(expected, 12)
  })
})
