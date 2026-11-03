// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { useNewStages, type UseNewStages } from '~/composables/useNewStages'
import { resetProgressNoticeForTests, useProgress } from '~/composables/useProgress'
import { practicePlan } from '~/data/practice-plan'
import { SEEN_STAGES_STORAGE_KEY } from '~/utils/newStages'
import { PROGRESS_STORAGE_KEY } from '~/utils/progress'

async function mountNewStages(): Promise<UseNewStages> {
  let api!: UseNewStages
  mount(defineComponent({
    setup() {
      const { progress, loaded } = useProgress()
      api = useNewStages(progress, loaded)
      return () => h('div')
    },
  }))
  await flushPromises() // watch(loaded) 在下一個 tick 執行
  return api
}

const legacyProgress = JSON.stringify({ v: 1, stages: Object.fromEntries(
  ['stage-1', 'stage-2', 'stage-3', 'stage-4', 'stage-5', 'stage-6'].map(id => [id, { completedAt: '2026-10-20T00:00:00.000Z' }])) })

beforeEach(() => {
  localStorage.clear()
  resetProgressNoticeForTests()
})

describe('useNewStages (D-C1)', () => {
  it('a user who finished stages 1–6 before the update sees stages 7–12 as new until dismissed', async () => {
    localStorage.setItem(PROGRESS_STORAGE_KEY, legacyProgress)
    const a = await mountNewStages()
    expect(a.newStageIds.value).toEqual(['stage-7', 'stage-8', 'stage-9', 'stage-10', 'stage-11', 'stage-12'])
    a.dismiss()
    expect(a.newStageIds.value).toEqual([])
    expect(JSON.parse(localStorage.getItem(SEEN_STAGES_STORAGE_KEY)!)).toEqual(practicePlan.map(s => s.id))
    expect((await mountNewStages()).newStageIds.value).toEqual([]) // 重新整理後不再出現
  })

  it('a brand-new user never sees the notice, and all current stages are recorded as seen', async () => {
    const a = await mountNewStages()
    expect(a.newStageIds.value).toEqual([])
    expect(JSON.parse(localStorage.getItem(SEEN_STAGES_STORAGE_KEY)!)).toEqual(practicePlan.map(s => s.id))
  })
})
