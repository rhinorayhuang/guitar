import { describe, expect, it } from 'vitest'
import { createTunerPipeline } from '~/utils/tuner/pipeline'
import { TUNER_STRINGS } from '~/utils/tuner/strings'
import { runOffline } from '../helpers/offline'
import { centsOff, concat, pluck, silence, sine, steppedSine, whiteNoise, withNoise } from '../helpers/signals'

const RATES = [44100, 48000] as const
const A2 = TUNER_STRINGS[1]!.frequency

const std = (xs: number[]) => {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length)
}

describe('pipeline (offline, synthetic F tests)', () => {
  it('exposes the window size for the sample rate', () => {
    expect(createTunerPipeline({ sampleRate: 48000 }).windowSize).toBe(2048)
    expect(createTunerPipeline({ sampleRate: 96000 }).windowSize).toBe(4096)
  })

  it.each(RATES)('TUN-20(F): first gate-open frame → first reading ≤ 150 ms @ %d', (sr) => {
    const frames = runOffline(concat(silence(sr, 0.2), pluck(A2, sr, 1)), sr)
    const onset = frames.find(f => f.analysis.kind !== 'silent')!
    const first = frames.find(f => f.state.reading)!
    expect(onset && first).toBeTruthy()
    expect(first.t - onset.t).toBeLessThanOrEqual(150)
    expect(first.view.noteLabel).toBe('A2')
  })

  it.each(RATES)('TUN-21: ≥ 10 reading updates per second on a sustained pluck @ %d', (sr) => {
    const frames = runOffline(pluck(A2, sr, 1.2), sr)
    const active = frames.filter(f => f.state.signal === 'active' && f.t >= 200 && f.t < 1200)
    expect(active.length).toBeGreaterThanOrEqual(10)
  })

  it.each(RATES)('TUN-38: stable tone + SNR 20 dB → displayCents std ≤ 1 over any 1 s window @ %d', (sr) => {
    const f = centsOff(A2, 3)
    const frames = runOffline(withNoise(sine(f, sr, 3), 20, 9), sr).filter(fr => fr.state.reading && fr.t >= 300)
    for (let start = 300; start + 1000 <= frames.at(-1)!.t; start += 250) {
      const win = frames.filter(fr => fr.t >= start && fr.t < start + 1000).map(fr => fr.state.reading!.displayCents)
      expect(win.length).toBeGreaterThan(30)
      expect(std(win)).toBeLessThanOrEqual(1)
    }
  })

  it.each(RATES)('TUN-38: step −20 → 0 cents settles within ±2 cents in 300 ms @ %d', (sr) => {
    const sig = steppedSine([{ freq: centsOff(A2, -20), durS: 1 }, { freq: A2, durS: 1 }], sr)
    const frames = runOffline(sig, sr)
    const before = frames.filter(f => f.t > 600 && f.t <= 1000)
    for (const f of before) expect(Math.abs(f.state.reading!.displayCents + 20)).toBeLessThanOrEqual(1)
    for (const f of frames.filter(fr => fr.t >= 1300)) expect(Math.abs(f.state.reading!.displayCents)).toBeLessThanOrEqual(2)
  })

  it.each(RATES)('TUN-33: 3 s of silence or −60 dBFS noise → 0 readings @ %d', (sr) => {
    for (const sig of [silence(sr, 3), whiteNoise(sr, 3, -60)]) {
      const frames = runOffline(sig, sr)
      expect(frames.length).toBeGreaterThan(100)
      expect(frames.filter(f => f.state.reading).length).toBe(0)
    }
  })

  it.each(RATES)('TUN-30: stable 0-cent pluck reaches inTune once, ~0.5 s after the first reading @ %d', (sr) => {
    const frames = runOffline(pluck(A2, sr, 2), sr)
    const first = frames.find(f => f.state.reading)!
    const inTune = frames.find(f => f.state.tune.status === 'inTune')!
    expect(inTune.t - first.t).toBeGreaterThanOrEqual(500)
    expect(inTune.t - first.t).toBeLessThan(600)
    let transitions = 0
    for (let i = 1; i < frames.length; i++) {
      if (frames[i - 1]!.state.tune.status !== 'inTune' && frames[i]!.state.tune.status === 'inTune') transitions++
    }
    expect(transitions).toBe(1)
    expect(frames.at(-1)!.view.status).toBe('inTune')
  })
})
