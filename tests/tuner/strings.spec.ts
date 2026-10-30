import { describe, expect, it } from 'vitest'
import { frequencyToMidi, midiToFrequency, noteLabel, noteOctave } from '~/utils/music'
import {
  TUNER_STRINGS, centsBetween, frequencyToTarget, nearestStringIndex, parseStoredMode, serializeMode,
} from '~/utils/tuner/strings'

describe('music.ts helpers', () => {
  it('midiToFrequency / frequencyToMidi are inverses around A4 = 440', () => {
    expect(midiToFrequency(69)).toBe(440)
    expect(frequencyToMidi(440)).toBe(69)
    expect(frequencyToMidi(midiToFrequency(40.37))).toBeCloseTo(40.37, 10)
  })

  it('noteOctave / noteLabel', () => {
    expect(noteOctave(40)).toBe(2)
    expect(noteOctave(60)).toBe(4)
    expect(noteLabel(40)).toBe('E2')
    expect(noteLabel(59)).toBe('B3')
  })
})

describe('TUN-01: string targets computed from STANDARD_TUNING', () => {
  // PRD §5.1.1 表格（四捨五入至 0.01 Hz）；只在測試中出現
  const PRD_TABLE = [
    [6, 'E2', 82.41], [5, 'A2', 110.0], [4, 'D3', 146.83], [3, 'G3', 196.0], [2, 'B3', 246.94], [1, 'E4', 329.63],
  ] as const

  it.each(PRD_TABLE.map((row, i) => [i, ...row] as const))('index %d = 第 %d 弦 %s ≈ %d Hz', (i, stringNumber, label, hz) => {
    const s = TUNER_STRINGS[i]!
    expect(s.stringNumber).toBe(stringNumber)
    expect(s.label).toBe(label)
    expect(Math.abs(s.frequency - hz)).toBeLessThan(0.01)
  })
})

describe('TUN-02: centsBetween', () => {
  it('matches PRD examples', () => {
    expect(centsBetween(110, 110)).toBe(0)
    expect(centsBetween(111, 110)).toBeCloseTo(15.7, 1)
    expect(Math.abs(centsBetween(82, TUNER_STRINGS[0]!.frequency) - -8.6)).toBeLessThan(0.05)
  })
})

describe('TUN-10/14: nearest string', () => {
  it('maps PRD examples', () => {
    expect(nearestStringIndex(94)).toBe(0)
    expect(nearestStringIndex(96)).toBe(1)
    expect(nearestStringIndex(220)).toBe(3)
  })

  it('takes the lower string exactly at the E2/A2 boundary', () => {
    const boundary = Math.sqrt(TUNER_STRINGS[0]!.frequency * TUNER_STRINGS[1]!.frequency)
    expect(boundary).toBeCloseTo(95.21, 2)
    expect(nearestStringIndex(boundary)).toBe(0)
    expect(nearestStringIndex(boundary * 1.0001)).toBe(1)
  })

  it('auto-mode cents never exceed about ±250 inside the guitar range', () => {
    let max = 0
    for (let f = 82; f <= 330; f += 0.25) max = Math.max(max, Math.abs(frequencyToTarget(f, { kind: 'auto' }).cents))
    expect(max).toBeLessThanOrEqual(250)
  })

  it('manual mode always measures against the selected string', () => {
    const t = frequencyToTarget(82, { kind: 'manual', stringIndex: 1 })
    expect(t.string.label).toBe('A2')
    expect(t.cents).toBeCloseTo(-508.6, 1)
  })
})

describe('TUN-15: stored mode parsing', () => {
  it('round-trips', () => {
    expect(parseStoredMode(serializeMode({ kind: 'auto' }))).toEqual({ kind: 'auto' })
    expect(parseStoredMode(serializeMode({ kind: 'manual', stringIndex: 4 }))).toEqual({ kind: 'manual', stringIndex: 4 })
  })

  it.each([
    null, '', '{', 'null', '42', '"auto"',
    '{"kind":"auto"}', '{"v":2,"kind":"auto"}',
    '{"v":1,"kind":"manual","stringIndex":6}', '{"v":1,"kind":"manual","stringIndex":-1}',
    '{"v":1,"kind":"manual","stringIndex":1.5}', '{"v":1,"kind":"manual"}', '{"v":1,"kind":"other"}',
  ])('rejects %j', (raw) => {
    expect(parseStoredMode(raw)).toBeNull()
  })
})
