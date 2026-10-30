import { describe, expect, it } from 'vitest'
import { estimateAudibleTime } from '~/utils/clock/audibleTime'

describe('estimateAudibleTime (§5.1)', () => {
  it('uses a valid output timestamp, extrapolated to this frame', () => {
    const t = estimateAudibleTime({
      currentTime: 10.05, perfNow: 5020, timestamp: { contextTime: 10, performanceTime: 5000 }, outputLatency: 0.3,
    })
    expect(t).toBeCloseTo(10.02, 9)
  })

  it('clamps the timestamp result to ≤ currentTime', () => {
    expect(estimateAudibleTime({ currentTime: 10, perfNow: 5100, timestamp: { contextTime: 10, performanceTime: 5000 } })).toBe(10)
  })

  it('all-zero timestamp (Chrome before output starts) falls back to latencies', () => {
    const t = estimateAudibleTime({
      currentTime: 10, perfNow: 5000, timestamp: { contextTime: 0, performanceTime: 0 }, outputLatency: 0.1,
    })
    expect(t).toBeCloseTo(9.9, 9)
  })

  it('fallback: currentTime − outputLatency − baseLatency', () => {
    expect(estimateAudibleTime({ currentTime: 10, perfNow: 0, outputLatency: 0.1, baseLatency: 0.01 })).toBeCloseTo(9.89, 9)
  })

  it('undefined / NaN latency is treated as 0', () => {
    expect(estimateAudibleTime({ currentTime: 10, perfNow: 0 })).toBe(10)
    expect(estimateAudibleTime({ currentTime: 10, perfNow: 0, outputLatency: Number.NaN, baseLatency: Number.NaN })).toBe(10)
  })

  it('outputLatency = 3 is clamped to 0.5', () => {
    expect(estimateAudibleTime({ currentTime: 10, perfNow: 0, outputLatency: 3 })).toBeCloseTo(9.5, 9)
  })

  it('result always within [currentTime − 0.5, currentTime]', () => {
    const cases = [
      { currentTime: 5, perfNow: 0, outputLatency: 0.4, baseLatency: 0.4 },
      { currentTime: 5, perfNow: 100, timestamp: { contextTime: 1, performanceTime: 100 } },
      { currentTime: 5, perfNow: 100000, timestamp: { contextTime: 4.9, performanceTime: 100 } },
      { currentTime: 5, perfNow: 0, outputLatency: -1 },
    ]
    for (const c of cases) {
      const t = estimateAudibleTime(c)
      expect(t).toBeLessThanOrEqual(5)
      expect(t).toBeGreaterThanOrEqual(4.5)
    }
  })
})
