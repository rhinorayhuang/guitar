export type NoteName = 'C' | 'C#' | 'D' | 'D#' | 'E' | 'F' | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B'

export type ChordQuality = 'major' | 'minor' | '7' | 'maj7' | 'm7' | 'sus2' | 'sus4'

/** Fret per string: null = muted (x), 0 = open, 1+ = absolute fret number */
export type Fret = number | null

/** 0 = no finger, 1 index, 2 middle, 3 ring, 4 pinky */
export type Finger = 0 | 1 | 2 | 3 | 4

/** Six entries, index 0 = 6th string (low E) → index 5 = 1st string (high E) */
export type SixStrings<T> = [T, T, T, T, T, T]

export interface Barre {
  fret: number
  /** Guitarist numbering: 6 = low E, 1 = high E. fromString >= toString */
  fromString: number
  toString: number
  finger: Finger
}

export interface ChordShape {
  id: string
  /** Display name, e.g. "Am" */
  name: string
  root: NoteName
  quality: ChordQuality
  frets: SixStrings<Fret>
  fingers: SixStrings<Finger>
  barre?: Barre
  /** 1 = easiest */
  difficulty: 1 | 2 | 3 | 4 | 5
  tips?: string[]
}

export interface PracticeStage {
  id: string
  title: string
  chords: string[]
  transitions: [string, string][]
  targetBpm: number
  dailyMinutes: number
  completion: string
  tips: string[]
  /** 1–2 句「為什麼」的樂理說明（PRD PA-07）；選填，永遠不是過關條件 */
  theoryNote?: string
  /** 整關使用的刷法，見 StrumPattern */
  strumPattern?: StrumPattern
  /** 歌曲段落（第 12 關）；bars 加總等於過關標準寫的小節數 */
  sections?: SongSection[]
}

/**
 * 一小節 8 個八分音符位置的刷法：'D' 下刷、'U' 上刷、'.' 手照樣揮但不碰弦。
 * 手臂一直上下擺，所以 'D' 只能在拍點（偶數位置）、'U' 只能在「與」（奇數位置）。
 * 例：'DUDUDUDU' 全上下刷；'D.DU.UDU' 下、下上、上下上；'D.......' 只刷第 1 拍。
 */
export type StrumPattern = string

export interface SongSection {
  name: string
  bars: number
  /** 每小節一個和弦 id，長度 = bars */
  progression: string[]
  strum: StrumPattern
}
