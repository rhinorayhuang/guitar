import type { ChordShape } from '~/types/chord'
import { chordTones, pitchClass, soundingNotes } from '~/utils/music'

/** Returns human-readable problems; an empty array means the shape is valid */
export function validateChord(chord: ChordShape): string[] {
  const errors: string[] = []
  const { frets, fingers, barre } = chord

  if (frets.length !== 6 || fingers.length !== 6) {
    return ['frets and fingers must both have 6 entries']
  }

  // Finger assignment
  frets.forEach((fret, i) => {
    const string = 6 - i
    if ((fret === null || fret === 0) && fingers[i] !== 0) {
      errors.push(`string ${string}: open/muted string must have finger 0`)
    }
    if (fret !== null && fret > 0 && fingers[i] === 0) {
      errors.push(`string ${string}: fretted note needs a finger`)
    }
  })

  // One finger cannot press two different frets; same fret on several strings needs a barre
  const fretsByFinger = new Map<number, Set<number>>()
  fingers.forEach((finger, i) => {
    const fret = frets[i]
    if (finger === 0 || fret == null || fret === 0) return
    const set = fretsByFinger.get(finger) ?? new Set<number>()
    set.add(fret)
    fretsByFinger.set(finger, set)
  })
  for (const [finger, set] of fretsByFinger) {
    if (set.size > 1) errors.push(`finger ${finger} is used on different frets: ${[...set].join(', ')}`)
    const strings = fingers.filter((f, i) => f === finger && frets[i]! > 0).length
    if (strings > 1 && barre?.finger !== finger) {
      errors.push(`finger ${finger} covers ${strings} strings without a declared barre`)
    }
  }

  // Barre consistency
  if (barre) {
    for (let string = barre.fromString; string >= barre.toString; string--) {
      const i = 6 - string
      const fret = frets[i]
      if (fret == null || fret < barre.fret) {
        errors.push(`string ${string}: below barre at fret ${barre.fret}`)
      } else if (fret === barre.fret && fingers[i] !== barre.finger) {
        errors.push(`string ${string}: at barre fret but not using barre finger ${barre.finger}`)
      }
    }
  }

  // Stretch
  const fretted = frets.filter((f): f is number => f !== null && f > 0)
  if (fretted.length) {
    const span = Math.max(...fretted) - Math.min(...fretted)
    const maxSpan = chord.difficulty <= 2 ? 2 : 3
    if (span > maxSpan) errors.push(`fret span ${span + 1} is too wide for difficulty ${chord.difficulty}`)
  }

  // Harmony: notes must spell the named chord
  const notes = soundingNotes(chord)
  if (notes.length < 3) {
    errors.push('fewer than 3 sounding strings')
    return errors
  }
  const tones = chordTones(chord.root, chord.quality)
  const classes = new Set(notes.map(pitchClass))
  for (const note of classes) {
    if (!tones.includes(note)) errors.push(`${note} is not a chord tone of ${chord.name} (${tones.join(' ')})`)
  }
  if (!classes.has(tones[0]!)) errors.push(`missing root ${tones[0]}`)
  if (!chord.quality.startsWith('sus') && !classes.has(tones[1]!)) errors.push(`missing third ${tones[1]}`)
  const bass = pitchClass(notes[0]!)
  if (bass !== chord.root) errors.push(`bass note is ${bass}, expected root ${chord.root}`)

  return errors
}
