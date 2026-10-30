import { describe, expect, it } from 'vitest'
import { chords } from '~/data/chords'
import { practicePlan } from '~/data/practice-plan'
import { chordTones, stringNoteNames } from '~/utils/music'
import { validateChord } from '~/utils/validateChord'
import type { ChordShape } from '~/types/chord'

describe('PA-06: note names shown in the chord library', () => {
  const byId = (id: string) => chords.find(c => c.id === id)!

  // 期望值手算（標準調音 E A D G B E），不由實作推導
  it.each([
    ['Em-open', ['E', 'B', 'E', 'G', 'B', 'E']],
    ['C-open', [null, 'C', 'E', 'G', 'C', 'E']],
    ['D-open', [null, null, 'D', 'A', 'D', 'F#']],
    ['G-open', ['G', 'B', 'D', 'G', 'B', 'G']],
  ] as const)('%s sounds %j from the 6th string', (id, expected) => {
    expect(stringNoteNames(byId(id))).toEqual(expected)
  })

  it.each([
    ['Em-open', ['E', 'G', 'B']],
    ['E-open', ['E', 'G#', 'B']],
    ['Dm-open', ['D', 'F', 'A']],
  ] as const)('%s chord tones are %j', (id, expected) => {
    const c = byId(id)
    expect(chordTones(c.root, c.quality)).toEqual(expected)
  })

  it('every sounding note of every chord is one of its chord tones (what the page displays is consistent)', () => {
    for (const c of chords) {
      const tones = chordTones(c.root, c.quality)
      for (const note of stringNoteNames(c)) if (note) expect(tones, c.id).toContain(note)
    }
  })
})

describe('chord data', () => {
  it.each(chords.map(c => [c.id, c] as const))('%s is a valid, playable shape', (_, chord) => {
    expect(validateChord(chord)).toEqual([])
  })

  it('has unique ids', () => {
    expect(new Set(chords.map(c => c.id)).size).toBe(chords.length)
  })
})

describe('validateChord catches common mistakes', () => {
  const C = chords.find(c => c.id === 'C-open')!

  it('rejects C with the 6th string open (E in the bass)', () => {
    const wrong: ChordShape = { ...C, frets: [0, 3, 2, 0, 1, 0] }
    expect(validateChord(wrong)).toContain('bass note is E, expected root C')
  })

  it('rejects a note outside the chord', () => {
    const wrong: ChordShape = { ...C, frets: [null, 3, 2, 0, 1, 1], fingers: [0, 3, 2, 0, 1, 1] }
    expect(validateChord(wrong).some(e => e.includes('not a chord tone'))).toBe(true)
  })

  it('rejects a finger on an open string', () => {
    const wrong: ChordShape = { ...C, fingers: [0, 3, 2, 4, 1, 0] }
    expect(validateChord(wrong)).toContain('string 3: open/muted string must have finger 0')
  })
})

describe('practice plan', () => {
  const ids = new Set(chords.map(c => c.id))

  it('only references existing chords', () => {
    for (const stage of practicePlan) {
      for (const id of [...stage.chords, ...stage.transitions.flat()]) expect(ids.has(id), `${stage.id}: ${id}`).toBe(true)
    }
  })

  it('only practises transitions between chords already introduced', () => {
    const learned = new Set<string>()
    for (const stage of practicePlan) {
      stage.chords.forEach(id => learned.add(id))
      for (const id of stage.transitions.flat()) expect(learned.has(id), `${stage.id}: ${id}`).toBe(true)
    }
  })

  it('introduces barre chords only after at least 6 open chords', () => {
    const learned = new Set<string>()
    for (const stage of practicePlan) {
      for (const id of stage.chords) {
        if (chords.find(c => c.id === id)?.barre) expect(learned.size, `${stage.id}: ${id}`).toBeGreaterThanOrEqual(6)
        learned.add(id)
      }
    }
  })
})

describe('PA-07: theoryNote', () => {
  const stage = (id: string) => practicePlan.find(s => s.id === id)!
  const chord = (id: string) => chords.find(c => c.id === id)!

  it('is written only for stages 1, 2 and 5 for now, and stays short (≤ 2 sentences)', () => {
    expect(practicePlan.filter(s => s.theoryNote).map(s => s.id)).toEqual(['stage-1', 'stage-2', 'stage-5'])
    for (const s of practicePlan) {
      if (!s.theoryNote) continue
      expect(s.theoryNote.split('。').filter(Boolean).length, s.id).toBeLessThanOrEqual(2)
      expect(s.theoryNote.length, s.id).toBeLessThanOrEqual(140)
    }
  })

  it('never becomes a pass condition', () => {
    for (const s of practicePlan) expect(s.completion, s.id).not.toMatch(/樂理|級數|三度|音程/)
  })

  // 以下驗證說明裡的說法在使用者手上的指法成立
  it('stage 1: Em and E differ on exactly one string, by one semitone (G → G#)', () => {
    const em = stringNoteNames(chord('Em-open'))
    const e = stringNoteNames(chord('E-open'))
    const diff = em.flatMap((n, i) => (n === e[i] ? [] : [[i, n, e[i]]]))
    expect(diff).toEqual([[3, 'G', 'G#']]) // index 3 = 第 3 弦
  })

  it('stage 2: Am uses the E shape moved one string thinner', () => {
    const e = chord('E-open').frets
    const am = chord('Am-open').frets
    expect(am.slice(2, 5)).toEqual(e.slice(1, 4))
  })

  it('stage 5: every chord of the stage uses only notes of the C major scale, on degrees I V vi ii iii', () => {
    const cMajor = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
    const ids = stage('stage-5').chords
    expect(ids).toEqual(['C-open', 'G-open', 'Am-open', 'Dm-open', 'Em-open'])
    for (const id of ids) {
      for (const note of stringNoteNames(chord(id))) if (note) expect(cMajor, id).toContain(note)
    }
    // 「第 1、5、6、2、3 個音」：根音在 C 大調音階中的位置
    expect(ids.map(id => cMajor.indexOf(chord(id).root) + 1)).toEqual([1, 5, 6, 2, 3])
  })

  it('stage 2: the index finger lands on C at string 2 fret 1 (not C#)', () => {
    expect(stringNoteNames(chord('Am-open'))[4]).toBe('C') // index 4 = 第 2 弦
  })
})
