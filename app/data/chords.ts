import type { ChordShape } from '~/types/chord'

// frets / fingers: index 0 = 6th string (low E) → index 5 = 1st string (high E)
export const chords: ChordShape[] = [
  {
    id: 'Em-open', name: 'Em', root: 'E', quality: 'minor',
    frets: [0, 2, 2, 0, 0, 0], fingers: [0, 2, 3, 0, 0, 0], difficulty: 1,
    tips: ['六條弦全部刷，只需要兩根手指'],
  },
  {
    id: 'E-open', name: 'E', root: 'E', quality: 'major',
    frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0], difficulty: 1,
    tips: ['從 Em 加上食指壓第 3 弦第 1 格'],
  },
  {
    id: 'Am-open', name: 'Am', root: 'A', quality: 'minor',
    frets: [null, 0, 2, 2, 1, 0], fingers: [0, 0, 2, 3, 1, 0], difficulty: 1,
    tips: ['和 E 是同一個手型，整體往細弦移一條'],
  },
  {
    id: 'A-open', name: 'A', root: 'A', quality: 'major',
    frets: [null, 0, 2, 2, 2, 0], fingers: [0, 0, 1, 2, 3, 0], difficulty: 2,
    tips: ['三根手指擠在同一格，指尖要立起來，避免碰到第 1 弦'],
  },
  {
    id: 'D-open', name: 'D', root: 'D', quality: 'major',
    frets: [null, null, 0, 2, 3, 2], fingers: [0, 0, 0, 1, 3, 2], difficulty: 2,
    tips: ['只刷第 4 弦到第 1 弦'],
  },
  {
    id: 'Dm-open', name: 'Dm', root: 'D', quality: 'minor',
    frets: [null, null, 0, 2, 3, 1], fingers: [0, 0, 0, 2, 3, 1], difficulty: 2,
  },
  {
    id: 'G-open', name: 'G', root: 'G', quality: 'major',
    frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, 0, 0, 0, 3], difficulty: 2,
    tips: ['先學三指版本；熟練後可改用 3-2-4 指法，方便換到 C'],
  },
  {
    id: 'C-open', name: 'C', root: 'C', quality: 'major',
    frets: [null, 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0], difficulty: 2,
    tips: ['第 6 弦不要刷到，低音才會是 C'],
  },
  {
    id: 'F-barre', name: 'F', root: 'F', quality: 'major',
    frets: [1, 3, 3, 2, 1, 1], fingers: [1, 3, 4, 2, 1, 1],
    barre: { fret: 1, fromString: 6, toString: 1, finger: 1 },
    difficulty: 4,
    tips: ['食指用靠拇指那一側壓弦，手肘稍微往身體收'],
  },
]

export const chordById = (id: string) => chords.find(c => c.id === id)
