import type { ChordQuality, ChordShape, NoteName } from '~/types/chord'

export const NOTE_NAMES: NoteName[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** Standard tuning as MIDI numbers, index 0 = 6th string (E2) */
export const STANDARD_TUNING = [40, 45, 50, 55, 59, 64] as const

/** Semitone intervals from the root; the third (if any) is the second entry */
export const QUALITY_INTERVALS: Record<ChordQuality, number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
}

export const pitchClass = (midi: number): NoteName => NOTE_NAMES[midi % 12]!

/** Sounding MIDI notes, low to high, skipping muted strings */
export function soundingNotes(chord: Pick<ChordShape, 'frets'>): number[] {
  return chord.frets.flatMap((fret, i) => (fret === null ? [] : [STANDARD_TUNING[i]! + fret]))
}

/** Sounding note name per string, index 0 = 6th string; null = muted */
export function stringNoteNames(chord: Pick<ChordShape, 'frets'>): (NoteName | null)[] {
  return chord.frets.map((fret, i) => (fret === null ? null : pitchClass(STANDARD_TUNING[i]! + fret)))
}

export function chordTones(root: NoteName, quality: ChordQuality): NoteName[] {
  const rootIndex = NOTE_NAMES.indexOf(root)
  return QUALITY_INTERVALS[quality].map(interval => NOTE_NAMES[(rootIndex + interval) % 12]!)
}

/** 十二平均律，A4 = 440 Hz。TUN-01：調音器所有頻率都經由此函式由 STANDARD_TUNING 算出 */
export function midiToFrequency(midi: number, a4 = 440): number {
  return a4 * 2 ** ((midi - 69) / 12)
}

/** 回傳浮點 MIDI（69 = A4） */
export function frequencyToMidi(freq: number, a4 = 440): number {
  return 69 + 12 * Math.log2(freq / a4)
}

export const noteOctave = (midi: number): number => Math.floor(midi / 12) - 1

/** 40 → 'E2' */
export const noteLabel = (midi: number): string => `${pitchClass(midi)}${noteOctave(midi)}`
