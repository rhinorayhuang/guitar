import { describe, expect, it } from 'vitest'
import { analyzeFrame } from '~/utils/tuner/frameAnalysis'
import { TUNER_PARAMS } from '~/utils/tuner/params'
import { createPitchDetector, detectorOptionsFor } from '~/utils/tuner/pitchDetector'
import { sine, whiteNoise } from '../helpers/signals'

const sr = 48000
const W = 2048
const detector = createPitchDetector(detectorOptionsFor(sr))
const frameOf = (sig: Float32Array) => sig.subarray(0, W)
/** RMS 恰為 dbfs 的正弦（振幅 = √2·rms） */
const sineAt = (freq: number, dbfs: number) => frameOf(sine(freq, sr, 0.05, Math.SQRT2 * 10 ** (dbfs / 20)))

describe('TUN-33/34: frame analysis', () => {
  it('all-zero → silent with -Infinity dBFS', () => {
    expect(analyzeFrame(new Float32Array(W), detector, TUNER_PARAMS, false)).toEqual({ kind: 'silent', dbfs: -Infinity })
  })

  it('−60 dBFS white noise → silent', () => {
    expect(analyzeFrame(frameOf(whiteNoise(sr, 0.05, -60)), detector, TUNER_PARAMS, false).kind).toBe('silent')
  })

  it('−30 dBFS white noise → unclear (low clarity / no pitch)', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const a = analyzeFrame(frameOf(whiteNoise(sr, 0.05, -30, seed)), detector, TUNER_PARAMS, false)
      expect(a.kind).toBe('unclear')
      if (a.kind === 'unclear') expect(['low-clarity', 'no-pitch']).toContain(a.reason)
    }
  })

  it('a clean A2 sine above the gate → pitched', () => {
    const a = analyzeFrame(sineAt(110, -20), detector, TUNER_PARAMS, false)
    expect(a.kind).toBe('pitched')
    if (a.kind === 'pitched') expect(a.freq).toBeCloseTo(110, 0)
  })

  it('out-of-range tone above the gate → unclear', () => {
    expect(analyzeFrame(sineAt(60, -20), detector, TUNER_PARAMS, false).kind).toBe('unclear')
  })

  it('gate hysteresis: −51 dBFS is silent while closed, open while already open', () => {
    const f = sineAt(110, -51)
    expect(analyzeFrame(f, detector, TUNER_PARAMS, false).kind).toBe('silent')
    expect(analyzeFrame(f, detector, TUNER_PARAMS, true).kind).toBe('pitched')
    expect(analyzeFrame(sineAt(110, -54), detector, TUNER_PARAMS, true).kind).toBe('silent')
  })
})
