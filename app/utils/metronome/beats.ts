import { BEATS_PER_BAR } from './params'

/** step 0 → { beatInBar: 0, accent: true }；每小節第 1 拍為重音 */
export function beatOf(step: number, beatsPerBar: number = BEATS_PER_BAR): { beatInBar: number; accent: boolean } {
  const beatInBar = ((step % beatsPerBar) + beatsPerBar) % beatsPerBar
  return { beatInBar, accent: beatInBar === 0 }
}
