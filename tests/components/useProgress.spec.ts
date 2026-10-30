// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { resetProgressNoticeForTests, useProgress, type UseProgress } from '~/composables/useProgress'
import { PROGRESS_STORAGE_KEY } from '~/utils/progress'

function mountProgress(): UseProgress {
  let api!: UseProgress
  mount(defineComponent({
    setup() {
      api = useProgress()
      return () => h('div')
    },
  }))
  return api
}

beforeEach(() => {
  localStorage.clear()
  resetProgressNoticeForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useProgress (Story 4)', () => {
  it('loads saved progress on mount and survives a remount', () => {
    const a = mountProgress()
    expect(a.loaded.value).toBe(true)
    a.setCompleted('stage-1', true)
    expect(JSON.parse(localStorage.getItem(PROGRESS_STORAGE_KEY)!).stages).toHaveProperty('stage-1')

    const b = mountProgress()
    expect(b.progress.value.stages).toHaveProperty('stage-1')
    b.setCompleted('stage-1', false)
    expect(mountProgress().progress.value.stages).toEqual({})
  })

  it('only ever writes its own key', () => {
    mountProgress().setCompleted('stage-2', true)
    expect(Object.keys(localStorage)).toEqual([PROGRESS_STORAGE_KEY])
  })

  it('keeps working without storage and shows the notice only once', () => {
    const throwing = { getItem: () => { throw new Error('SecurityError') }, setItem: () => { throw new Error('QuotaExceededError') } }
    vi.stubGlobal('localStorage', throwing)

    const a = mountProgress()
    expect(a.loaded.value).toBe(true)
    expect(a.storageNotice.value).toBe(true)
    a.setCompleted('stage-1', true)
    expect(a.progress.value.stages).toHaveProperty('stage-1') // 畫面照樣更新
    a.dismissNotice()
    expect(a.storageNotice.value).toBe(false)

    // 換頁再掛載：同一次瀏覽不再提示
    const b = mountProgress()
    b.setCompleted('stage-2', true)
    expect(b.storageNotice.value).toBe(false)
  })
})
