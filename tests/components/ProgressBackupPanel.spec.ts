// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import ProgressBackupPanel from '~/components/ProgressBackupPanel.vue'
import { resetProgressNoticeForTests, useProgress, type UseProgress } from '~/composables/useProgress'
import { PROGRESS_STORAGE_KEY, createBackup, emptyProgress, setStageCompleted } from '~/utils/progress'

/** 用真正的 useProgress 接上面板，驗證整條匯入路徑 */
function mountWithProgress() {
  let api!: UseProgress
  const w = mount(defineComponent({
    setup() {
      api = useProgress()
      return () => h(ProgressBackupPanel, { exportBackup: api.exportBackup, importFromText: api.importFromText })
    },
  }))
  return { w, api }
}

async function chooseFile(w: ReturnType<typeof mount>, text: string) {
  const input = w.find('[data-testid="backup-file"]')
  const file = new File([text], 'backup.json', { type: 'application/json' })
  Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
  await input.trigger('change')
  await flushPromises()
}

beforeEach(() => {
  localStorage.clear()
  resetProgressNoticeForTests()
})

describe('ProgressBackupPanel (D-07)', () => {
  it('importing a backup merges it, saves to localStorage and reports how many stages were added', async () => {
    const { w, api } = mountWithProgress()
    api.setCompleted('stage-3', true)
    const backup = createBackup(setStageCompleted(emptyProgress(), 'stage-1', true, new Date('2026-10-01T00:00:00Z')), new Date()).json
    await chooseFile(w, backup)

    expect(Object.keys(api.progress.value.stages).sort()).toEqual(['stage-1', 'stage-3'])
    expect(JSON.parse(localStorage.getItem(PROGRESS_STORAGE_KEY)!).stages).toHaveProperty('stage-1')
    expect(w.find('[data-testid="backup-message"]').text()).toContain('新增 1 關')
  })

  it('a wrong file shows an error and leaves progress untouched', async () => {
    const { w, api } = mountWithProgress()
    api.setCompleted('stage-2', true)
    await chooseFile(w, '{"hello":"world"}')
    expect(Object.keys(api.progress.value.stages)).toEqual(['stage-2'])
    const msg = w.find('[data-testid="backup-message"]')
    expect(msg.classes()).toContain('error')
    expect(msg.text()).toContain('不是本 App')
  })

  it('export downloads a JSON blob named by date', async () => {
    const created: string[] = []
    const createObjectURL = vi.fn(() => 'blob:mock')
    const revoke = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: revoke }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      created.push(this.download)
    })
    const { w } = mountWithProgress()
    await w.find('[data-testid="backup-export"]').trigger('click')
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(created[0]).toMatch(/^guitar-progress-\d{4}-\d{2}-\d{2}\.json$/)
    expect(w.find('[data-testid="backup-message"]').text()).toContain('已下載')
    click.mockRestore()
    vi.unstubAllGlobals()
  })
})
