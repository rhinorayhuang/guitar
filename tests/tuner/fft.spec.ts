import { describe, expect, it } from 'vitest'
import { createFft } from '~/utils/tuner/fft'
import { createPitchDetector, detectorOptionsFor } from '~/utils/tuner/pitchDetector'
import { nsdfReference } from '../helpers/nsdfReference'
import { mulberry32 } from '../helpers/prng'
import { TUNER_STRINGS } from '~/utils/tuner/strings'
import { pluck } from '../helpers/signals'

describe('fft', () => {
  it('rejects non power-of-two sizes', () => {
    expect(() => createFft(1000)).toThrow()
  })

  it('round-trips FFT → IFFT within 1e-9', () => {
    const rand = mulberry32(42)
    const fft = createFft(1024)
    const re = Float64Array.from({ length: 1024 }, () => rand() * 2 - 1)
    const im = Float64Array.from({ length: 1024 }, () => rand() * 2 - 1)
    const re0 = re.slice()
    const im0 = im.slice()
    fft.forward(re, im)
    fft.inverse(re, im)
    for (let i = 0; i < 1024; i++) {
      expect(Math.abs(re[i]! - re0[i]!)).toBeLessThan(1e-9)
      expect(Math.abs(im[i]! - im0[i]!)).toBeLessThan(1e-9)
    }
  })

  it('computes a known DFT bin (cosine at bin 3)', () => {
    const fft = createFft(16)
    const re = Float64Array.from({ length: 16 }, (_, i) => Math.cos((2 * Math.PI * 3 * i) / 16))
    const im = new Float64Array(16)
    fft.forward(re, im)
    expect(re[3]).toBeCloseTo(8, 9)
    expect(re[13]).toBeCloseTo(8, 9)
    expect(Math.abs(re[4]!)).toBeLessThan(1e-9)
  })
})

describe('FFT-based NSDF matches the direct O(W·τ) reference', () => {
  it.each([44100, 48000])('@ %d Hz', (sr) => {
    // 參考實作不含前置低通，比對時關閉
    const det = createPitchDetector({ ...detectorOptionsFor(sr), lowpassHz: 0 })
    const W = det.options.windowSize
    const frame = pluck(110, sr, 0.2).subarray(2000, 2000 + W)
    const ref = nsdfReference(frame, det.searchEnd)
    const fast = det.computeNsdf(frame)
    for (let tau = 0; tau <= det.searchEnd; tau++) expect(Math.abs(fast[tau]! - ref[tau]!)).toBeLessThan(1e-6)
  })
})

// 參考實作不含低通，濾波路徑改以「開/關的估計差」把關：零相位濾波不得把音高推偏
describe('lowpass path (lowpassHz, added beyond the architecture)', () => {
  it.each([44100, 48000])('estimates with and without the 5 kHz lowpass differ by < 0.5 cent on every string @ %d Hz', (sr) => {
    const on = createPitchDetector(detectorOptionsFor(sr))
    const off = createPitchDetector({ ...detectorOptionsFor(sr), lowpassHz: 0 })
    const W = on.options.windowSize
    for (const s of TUNER_STRINGS) {
      const sig = pluck(s.frequency, sr, 0.3, { seed: Math.round(s.frequency) })
      for (let start = Math.round(0.06 * sr); start + W <= sig.length; start += Math.round(sr / 60)) {
        const frame = sig.subarray(start, start + W)
        const a = on.detect(frame)
        const b = off.detect(frame)
        expect(a, s.label).not.toBeNull()
        expect(b, s.label).not.toBeNull()
        expect(Math.abs(1200 * Math.log2(a!.freq / b!.freq)), s.label).toBeLessThan(0.5)
      }
    }
  })

  it('is disabled when the cutoff is at or above Nyquist', () => {
    const sr = 8000
    const det = createPitchDetector({ ...detectorOptionsFor(sr), lowpassHz: 5000 })
    const ref = createPitchDetector({ ...detectorOptionsFor(sr), lowpassHz: 0 })
    const frame = pluck(110, sr, 0.5).subarray(1000, 1000 + det.options.windowSize)
    expect(Array.from(det.computeNsdf(frame))).toEqual(Array.from(ref.computeNsdf(frame)))
  })
})
