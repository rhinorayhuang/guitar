import type { StrumPattern } from '~/types/chord'

/** 一小節 8 個八分音符位置的刷法（見 StrumPattern 型別說明） */

export type Stroke = 'down' | 'up' | 'miss'

export interface StrumCell {
  /** '1'…'4' 或 '與' */
  count: string
  stroke: Stroke
  /** 拍點（偶數位置）手往下、「與」手往上；'miss' 時手照樣揮 */
  handDirection: 'down' | 'up'
}

const COUNTS = ['1', '與', '2', '與', '3', '與', '4', '與'] as const

/** 8 格、只含 D/U/.，且 D 只在拍點、U 只在「與」（手臂一直上下擺） */
export function isValidStrum(pattern: string): boolean {
  if (!/^[DU.]{8}$/.test(pattern)) return false
  return [...pattern].every((c, i) => c === '.' || (c === 'D') === (i % 2 === 0))
}

export function parseStrum(pattern: StrumPattern): StrumCell[] {
  if (!isValidStrum(pattern)) throw new Error(`invalid strum pattern: ${pattern}`)
  return [...pattern].map((c, i) => ({
    count: COUNTS[i]!,
    stroke: c === 'D' ? 'down' : c === 'U' ? 'up' : 'miss',
    handDirection: i % 2 === 0 ? 'down' : 'up',
  }))
}

/** 給讀屏與文字說明：'D.DU.UDU' → '下、下上、上下上'；只刷第 1 拍 → '只刷第 1 拍' */
export function describeStrum(pattern: StrumPattern): string {
  const cells = parseStrum(pattern)
  const hits = cells.filter(c => c.stroke !== 'miss')
  if (hits.length === 1 && cells[0]!.stroke === 'down') return '只刷第 1 拍'
  if (hits.length === 8) return '每拍下、上'
  if (cells.every((c, i) => (i % 2 === 0) === (c.stroke === 'down'))) return '每拍下刷一下'
  // 依拍分組：每拍兩格，空揮不寫，整拍空揮的組省略
  const groups: string[] = []
  for (let beat = 0; beat < 4; beat++) {
    const g = cells.slice(beat * 2, beat * 2 + 2).filter(c => c.stroke !== 'miss').map(c => (c.stroke === 'down' ? '下' : '上')).join('')
    if (g) groups.push(g)
  }
  // 前一拍空揮、只剩「上」的組，併到下一組前面（D–DU–UDU 讀作「下、下上、上下上」）
  const merged: string[] = []
  let carry = ''
  for (const g of groups) {
    if (g === '上') carry += g
    else {
      merged.push(carry + g)
      carry = ''
    }
  }
  if (carry) merged.push(carry)
  return merged.join('、')
}
