import { describe, expect, it } from 'vitest'
import { practicePlan } from '~/data/practice-plan'
import { LEGACY_STAGE_IDS, describeStageRange, resolveSeenStages, unseenStages } from '~/utils/newStages'

describe('D-C1: new stages notice (pure)', () => {
  it('existing users without a seen list have seen exactly the legacy stages 1–6', () => {
    expect(resolveSeenStages(null, true)).toEqual([...LEGACY_STAGE_IDS])
    expect(unseenStages(practicePlan, resolveSeenStages(null, true)!)).toEqual(
      ['stage-7', 'stage-8', 'stage-9', 'stage-10', 'stage-11', 'stage-12'])
  })

  it('new users (no progress, no seen list) get null: nothing counts as new', () => {
    expect(resolveSeenStages(null, false)).toBeNull()
  })

  it('a stored list wins; a broken one falls back like a missing one', () => {
    const all = JSON.stringify(practicePlan.map(s => s.id))
    expect(unseenStages(practicePlan, resolveSeenStages(all, true)!)).toEqual([])
    expect(resolveSeenStages('{oops', true)).toEqual([...LEGACY_STAGE_IDS])
    expect(resolveSeenStages('[1,2]', false)).toBeNull()
  })

  it('describes ranges for the banner', () => {
    expect(describeStageRange(practicePlan, ['stage-7', 'stage-8', 'stage-9', 'stage-10', 'stage-11', 'stage-12'])).toBe('第 7–12 關')
    expect(describeStageRange(practicePlan, ['stage-9', 'stage-7'])).toBe('第 7、9 關')
    expect(describeStageRange(practicePlan, ['stage-7'])).toBe('第 7 關')
    expect(describeStageRange(practicePlan, [])).toBe('')
  })
})
