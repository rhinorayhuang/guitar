import { describe, expect, it } from 'vitest'
import { createStepQueue } from '~/utils/clock/stepQueue'

describe('stepQueue (§5.2)', () => {
  it('empty queue advances to undefined', () => {
    expect(createStepQueue().advance(100)).toBeUndefined()
  })

  it('returns the last step whose time ≤ audible and drops everything up to it', () => {
    const q = createStepQueue()
    for (let i = 0; i < 4; i++) q.push({ step: i, time: i + 1, beatInBar: i })
    expect(q.advance(0.99)).toBeUndefined()
    expect(q.advance(1.0)?.step).toBe(0)
    expect(q.advance(1.5)).toBeUndefined() // 沒有新的步
    expect(q.advance(3.5)?.step).toBe(2)
    expect(q.size).toBe(1)
  })

  it('clear() empties the queue', () => {
    const q = createStepQueue()
    q.push({ step: 0, time: 1, beatInBar: 0 })
    q.clear()
    expect(q.size).toBe(0)
  })

  it('stays bounded over a long run', () => {
    const q = createStepQueue()
    for (let i = 0; i < 10_000; i++) {
      q.push({ step: i, time: i, beatInBar: i % 4 })
      expect(q.advance(i - 1)?.step).toBe(i > 0 ? i - 1 : undefined)
    }
    expect(q.size).toBe(1)
  })
})
