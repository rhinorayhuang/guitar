import { describe, expect, it } from 'vitest'
import { TUNER_PARAMS, windowSizeFor } from '~/utils/tuner/params'
import { computeRms, createPitchDetector, detectPitch, detectorOptionsFor, toDbfs, type PitchDetector } from '~/utils/tuner/pitchDetector'
import { TUNER_STRINGS } from '~/utils/tuner/strings'
import { centsError, centsOff, clip, pluck, sine, withNoise } from '../helpers/signals'

const RATES = [44100, 48000] as const
const OFFSETS = [-30, -10, 0, 10, 30] as const
const SKIP_S = 0.06

/** 從 60 ms 起以 hop = sr/60 滑動視窗，回傳每幀的估計 */
function estimatesOver(detector: PitchDetector, signal: Float32Array, sr: number) {
  const W = detector.options.windowSize
  const hop = Math.round(sr / 60)
  const out: (number | null)[] = []
  for (let start = Math.round(SKIP_S * sr); start + W <= signal.length; start += hop) {
    out.push(detector.detect(signal.subarray(start, start + W))?.freq ?? null)
  }
  return out
}

const detectors = new Map<number, PitchDetector>()
const detectorFor = (sr: number) => {
  if (!detectors.has(sr)) detectors.set(sr, createPitchDetector(detectorOptionsFor(sr)))
  return detectors.get(sr)!
}

describe('windowSizeFor', () => {
  it('is 2048 at 44.1/48 kHz and 4096 at 96 kHz', () => {
    expect(windowSizeFor(44100)).toBe(2048)
    expect(windowSizeFor(48000)).toBe(2048)
    expect(windowSizeFor(96000)).toBe(4096)
  })
})

describe('TUN-23: synthetic accuracy within ±1 cent on every frame', () => {
  const cases = RATES.flatMap(sr => TUNER_STRINGS.flatMap(s => OFFSETS.flatMap(off =>
    (['sine', 'pluck'] as const).map(kind => [kind, s.label, off, sr, s.frequency] as const))))

  it.each(cases)('%s %s %d¢ @ %d Hz', (kind, _label, off, sr, base) => {
    const f = centsOff(base, off)
    const sig = kind === 'sine' ? sine(f, sr, 0.3) : pluck(f, sr, 0.3, { seed: Math.round(f) })
    const ests = estimatesOver(detectorFor(sr), sig, sr)
    expect(ests.length).toBeGreaterThan(5)
    for (const est of ests) {
      expect(est).not.toBeNull()
      expect(Math.abs(centsError(est!, f))).toBeLessThanOrEqual(1)
    }
  })

  it.each([TUNER_STRINGS[0]!, TUNER_STRINGS[5]!])('96 kHz uses W=4096 and stays within ±1 cent ($label)', (s) => {
    const det = createPitchDetector(detectorOptionsFor(96000))
    expect(det.options.windowSize).toBe(4096)
    for (const sig of [sine(s.frequency, 96000, 0.3), pluck(s.frequency, 96000, 0.3)]) {
      for (const est of estimatesOver(det, sig, 96000)) expect(Math.abs(centsError(est!, s.frequency))).toBeLessThanOrEqual(1)
    }
  })
})

describe('TUN-22: detection range 70–450 Hz', () => {
  it.each(RATES)('65 Hz and 460 Hz sines are invalid @ %d', (sr) => {
    for (const f of [65, 460]) {
      for (const est of estimatesOver(detectorFor(sr), sine(f, sr, 0.3), sr)) expect(est, `${f} Hz`).toBeNull()
    }
  })

  it.each(RATES)('72 Hz and 440 Hz sines are valid within ±1 cent @ %d', (sr) => {
    for (const f of [72, 440]) {
      const ests = estimatesOver(detectorFor(sr), sine(f, sr, 0.3), sr)
      for (const est of ests) {
        expect(est, `${f} Hz`).not.toBeNull()
        expect(Math.abs(centsError(est!, f))).toBeLessThanOrEqual(1)
      }
    }
  })
})

/** 不得出現八度（±1200）或五度+八度（±1902）錯誤；以 ±600 cents 為界判斷 */
const assertNoOctaveError = (ests: (number | null)[], truth: number) => {
  for (const est of ests) if (est !== null) expect(Math.abs(centsError(est, truth))).toBeLessThan(600)
}

describe('TUN-25 (synthetic proxy): no octave errors on weak-fundamental 6th string', () => {
  it.each(RATES.flatMap(sr => [0.1, 0.2, 0.3].map(a => [a, sr] as const)))('fundamental amplitude %d @ %d Hz', (a, sr) => {
    const f = TUNER_STRINGS[0]!.frequency
    const sig = pluck(f, sr, 1, { harmonics: [a, 1.0, 0.7, 0.5, 0.35, 0.25], seed: 11 })
    const ests = estimatesOver(detectorFor(sr), sig, sr)
    expect(ests.filter(e => e !== null).length).toBeGreaterThan(ests.length * 0.9)
    assertNoOctaveError(ests, f)
  })

  it('octave guard corrects a T/2 pick when the 2nd harmonic dominates (and is what makes the difference)', () => {
    const sr = 48000
    const f = TUNER_STRINGS[0]!.frequency
    // 只有偶次泛音 + 弱基頻：n(T/2) 剛好越過 k·nMax，但比 n(T) 低超過 margin
    const sig = pluck(f, sr, 0.5, { harmonics: [0.18, 1.0, 0, 0.3], seed: 5 })
    const withGuard = estimatesOver(detectorFor(sr), sig, sr)
    assertNoOctaveError(withGuard, f)
    for (const est of withGuard) expect(Math.abs(centsError(est!, f))).toBeLessThanOrEqual(1)

    const noGuard = createPitchDetector({ ...detectorOptionsFor(sr), octaveGuardMargin: Infinity })
    expect(estimatesOver(noGuard, sig, sr).some(e => e !== null && Math.abs(centsError(e, f)) > 600)).toBe(true)
  })

  // 審查回歸：margin 0.05 時這兩組會 100% 報成 E3（n(T/2) 高到既被選中又不被修正）
  it.each(RATES.flatMap(sr => [[0.1, 1, 0, 0.3], [0.1, 1, 0.1, 0.5]].map(h => [h, sr] as const)))(
    'weak fundamental + weak odd harmonics %j is not reported an octave up @ %d Hz',
    (harmonics, sr) => {
      const f = TUNER_STRINGS[0]!.frequency
      const ests = estimatesOver(detectorFor(sr), pluck(f, sr, 0.5, { harmonics, seed: 5 }), sr)
      expect(ests.filter(e => e !== null).length).toBeGreaterThan(ests.length * 0.9)
      assertNoOctaveError(ests, f)
    },
  )

  // 反向：margin 越小越可能把正確的 τ0 改選成 2τ0；較高的弦加雜訊也不得報成低八度
  it.each(RATES.flatMap(sr => TUNER_STRINGS.slice(2).map(s => [s.label, sr, s.frequency] as const)))(
    '%s pluck at SNR 20 dB is never reported an octave down @ %d Hz',
    (_label, sr, f) => {
      const ests = estimatesOver(detectorFor(sr), withNoise(pluck(f, sr, 0.5, { seed: 9 }), 20), sr)
      assertNoOctaveError(ests, f)
    },
  )
})

describe('robustness', () => {
  it.each(RATES)('hard clipping at 30% of peak: ≤ ±2 cents, no octave error @ %d', (sr) => {
    for (const s of TUNER_STRINGS) {
      const sig = clip(pluck(s.frequency, sr, 0.4, { seed: s.index + 1 }), 0.3)
      const ests = estimatesOver(detectorFor(sr), sig, sr)
      assertNoOctaveError(ests, s.frequency)
      for (const est of ests) {
        expect(est, s.label).not.toBeNull()
        expect(Math.abs(centsError(est!, s.frequency)), s.label).toBeLessThanOrEqual(2)
      }
    }
  })

  it.each(RATES)('pluck + white noise at SNR 20 dB: ≤ ±2 cents per frame @ %d', (sr) => {
    for (const s of TUNER_STRINGS) {
      const sig = withNoise(pluck(s.frequency, sr, 0.4, { seed: s.index + 3 }), 20, s.index + 100)
      const ests = estimatesOver(detectorFor(sr), sig, sr)
      assertNoOctaveError(ests, s.frequency)
      for (const est of ests) {
        expect(est, s.label).not.toBeNull()
        expect(Math.abs(centsError(est!, s.frequency)), s.label).toBeLessThanOrEqual(2)
      }
    }
  })
})

describe('detectPitch / RMS helpers', () => {
  it('detectPitch matches the configured detector', () => {
    const sr = 48000
    const frame = sine(110, sr, windowSizeFor(sr) / sr)
    expect(Math.abs(centsError(detectPitch(frame, sr)!.freq, 110))).toBeLessThan(1)
  })

  it('returns null for an all-zero frame', () => {
    expect(detectPitch(new Float32Array(2048), 48000)).toBeNull()
  })

  it('computeRms removes DC; toDbfs(0) is -Infinity', () => {
    expect(computeRms(new Float32Array(100).fill(0.5))).toBe(0)
    expect(toDbfs(0)).toBe(-Infinity)
    expect(toDbfs(1)).toBe(0)
    expect(toDbfs(computeRms(sine(110, 48000, 0.1, 1)))).toBeCloseTo(-3.01, 1)
  })

  it('throws on wrong frame length', () => {
    expect(() => detectorFor(48000).detect(new Float32Array(100))).toThrow()
  })

  it('uses the default params', () => {
    expect(detectorFor(48000).options.k).toBe(TUNER_PARAMS.mpmK)
  })
})
