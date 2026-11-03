import { describe, expect, it } from 'vitest'
import { practicePlan } from '~/data/practice-plan'
import { describeStrum, isValidStrum, parseStrum } from '~/utils/strum'

describe('strum patterns', () => {
  it('validates length, characters and that D sits on beats / U on the "and"s', () => {
    expect(isValidStrum('DUDUDUDU')).toBe(true)
    expect(isValidStrum('D.DU.UDU')).toBe(true)
    expect(isValidStrum('D.......')).toBe(true)
    expect(isValidStrum('DUDUDUD')).toBe(false) // 7 格
    expect(isValidStrum('UDUDUDUD')).toBe(false) // 手的方向錯
    expect(isValidStrum('DUDUDUDX')).toBe(false)
  })

  it('parses counts, strokes and the always-moving hand', () => {
    const cells = parseStrum('D.DU.UDU')
    expect(cells.map(c => c.count)).toEqual(['1', '與', '2', '與', '3', '與', '4', '與'])
    expect(cells.map(c => c.stroke)).toEqual(['down', 'miss', 'down', 'up', 'miss', 'up', 'down', 'up'])
    expect(cells.map(c => c.handDirection)).toEqual(['down', 'up', 'down', 'up', 'down', 'up', 'down', 'up'])
    expect(() => parseStrum('nope')).toThrow()
  })

  it.each([
    ['DUDUDUDU', '每拍下、上'],
    ['D.DU.UDU', '下、下上、上下上'],
    ['D.......', '只刷第 1 拍'],
    ['D.D.D.D.', '每拍下刷一下'],
  ])('describes %s as %s', (p, text) => {
    expect(describeStrum(p)).toBe(text)
  })

  it('every pattern in the practice plan is valid', () => {
    for (const s of practicePlan) {
      if (s.strumPattern) expect(isValidStrum(s.strumPattern), s.id).toBe(true)
      for (const sec of s.sections ?? []) expect(isValidStrum(sec.strum), `${s.id} ${sec.name}`).toBe(true)
    }
  })

  it('stage 10 uses the D–DU–UDU pattern its completion describes', () => {
    const s = practicePlan.find(x => x.id === 'stage-10')!
    expect(describeStrum(s.strumPattern!)).toBe('下、下上、上下上')
    expect(s.completion).toContain('下、下上、上下上')
  })
})
