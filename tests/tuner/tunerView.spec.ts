import { describe, expect, it } from 'vitest'
import { tunerCopy } from '~/data/tuner-copy'
import { createInitialTunerState } from '~/utils/tuner/tunerMachine'
import { formatCents, formatFrequency, needlePosition, selectTunerView } from '~/utils/tuner/tunerView'
import { Driver, atCents, pitched, silent } from '../helpers/frames'

describe('TUN-42/44: formatting', () => {
  it('formats cents with U+2212 minus, plus sign and unit', () => {
    expect(formatCents(-12)).toBe('−12 ¢')
    expect(formatCents(3)).toBe('+3 ¢')
    expect(formatCents(0)).toBe('0 ¢')
    expect(formatCents(-180)).toBe('−180 ¢')
  })

  it('formats frequency with one decimal', () => {
    expect(formatFrequency(109.63)).toBe('109.6 Hz')
    expect(formatFrequency(82.4069)).toBe('82.4 Hz')
  })
})

describe('TUN-13/14: needle', () => {
  it('clamps beyond ±50 cents', () => {
    expect(needlePosition(180)).toBe(1)
    expect(needlePosition(-180)).toBe(-1)
    expect(needlePosition(25)).toBe(0.5)
    expect(needlePosition(0)).toBe(0)
  })
})

function viewAfter(cents: number, opts: { mode?: ConstructorParameters<typeof Driver>[0]; stringIndex?: number } = {}) {
  const d = new Driver(opts.mode, { medianSize: 1, emaTimeConstantMs: 1e-9 })
  d.repeat(pitched(atCents(opts.stringIndex ?? 1, cents)), 100, 10)
  return selectTunerView(d.state)
}

describe('selectTunerView', () => {
  it('waiting view in auto mode has no string and a centred needle', () => {
    const v = selectTunerView(createInitialTunerState())
    expect(v).toMatchObject({ status: 'waiting', string: null, noteName: null, centsText: null, needle: 0, isManual: false })
    expect(v.announcement).toBe(tunerCopy.waiting)
  })

  it('waiting view in manual mode keeps the selected string for highlighting', () => {
    const v = selectTunerView(createInitialTunerState({ kind: 'manual', stringIndex: 2 }))
    expect(v.string?.label).toBe('D3')
    expect(v.isManual).toBe(true)
    expect(v.noteName).toBeNull()
  })

  it('shows note, octave, string number, cents and frequency', () => {
    const v = viewAfter(-12)
    expect(v).toMatchObject({ noteName: 'A', noteLabel: 'A2', stringLabel: '第 5 弦', centsText: '−12 ¢', status: 'tooLow' })
    expect(v.frequencyText).toMatch(/^109\.\d Hz$/)
  })

  it('direction text: −6 too low (tighten), +6 too high (loosen)', () => {
    expect(viewAfter(-6).directionText).toBe(tunerCopy.direction.tooLow)
    expect(viewAfter(6).directionText).toBe(tunerCopy.direction.tooHigh)
    expect(viewAfter(3).directionText).toBe(tunerCopy.direction.approaching)
  })

  it('manual −180 cents: far-low text, needle pinned, real value shown', () => {
    const v = viewAfter(-180, { mode: { kind: 'manual', stringIndex: 1 } })
    expect(v.status).toBe('farLow')
    expect(v.directionText).toBe('差很多，請繼續轉緊')
    expect(v.needle).toBe(-1)
    expect(v.centsText).toBe('−180 ¢')
  })

  it('auto mode beyond ±50 pins the needle but keeps the normal direction text', () => {
    const v = viewAfter(70, { stringIndex: 0 })
    expect(v.needle).toBe(1)
    expect(v.status).toBe('tooHigh')
  })

  it('TUN-45: announcement changes only with the status class', () => {
    const d = new Driver(undefined, { medianSize: 1, emaTimeConstantMs: 1e-9 })
    const announcements = new Set<string>()
    const cents = [-30, -20, -12, -8, 20, 15]
    for (const c of cents) {
      d.repeat(pitched(atCents(1, c)), 50, 10)
      announcements.add(selectTunerView(d.state).announcement)
    }
    expect(announcements.size).toBe(1)

    d.repeat(pitched(atCents(1, 0)), 600, 10)
    const inTune = selectTunerView(d.state)
    expect(inTune.status).toBe('inTune')
    expect(inTune.announcement).not.toBe([...announcements][0])
    d.repeat(pitched(atCents(1, 2)), 100, 10)
    expect(selectTunerView(d.state).announcement).toBe(inTune.announcement)

    d.repeat(silent(), 2000, 10)
    expect(selectTunerView(d.state).announcement).toBe(tunerCopy.waiting)
  })

  it('fading is true while holding', () => {
    const d = new Driver()
    d.repeat(pitched(110), 100, 10)
    expect(selectTunerView(d.state).fading).toBe(false)
    d.feed(silent(), 10)
    expect(selectTunerView(d.state).fading).toBe(true)
  })
})
