// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TunerMeter from '~/components/tuner/TunerMeter.vue'
import TunerPanel from '~/components/tuner/TunerPanel.vue'
import TunerStringSelector from '~/components/tuner/TunerStringSelector.vue'
import { tunerCopy } from '~/data/tuner-copy'
import { createInitialTunerState } from '~/utils/tuner/tunerMachine'
import { selectTunerView, type TunerView } from '~/utils/tuner/tunerView'
import { domError, flush, installFakeAudio, type FakeEnv } from '../helpers/fakeAudio'
import { Driver, atCents, pitched } from '../helpers/frames'

let env: FakeEnv
let wrapper: VueWrapper | null = null

beforeEach(() => {
  localStorage.clear()
  env = installFakeAudio()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  env.restore()
  vi.restoreAllMocks()
})

function reinstall(opts: Parameters<typeof installFakeAudio>[0]) {
  env.restore()
  env = installFakeAudio(opts)
}

const text = () => wrapper!.text()

/** onMounted 會改 phase，等一個 tick 讓畫面更新 */
async function mountPanel() {
  wrapper = mount(TunerPanel)
  await flush()
}

describe('TunerPanel phases (TUN-50–59)', () => {
  it('idle shows intro copy, start button and reference tones', async () => {
    await mountPanel()
    expect(text()).toContain(tunerCopy.intro.title)
    expect(text()).toContain(tunerCopy.intro.body)
    expect(wrapper.find('[data-testid="tuner-start"]').text()).toBe(tunerCopy.intro.startButton)
    expect(wrapper.find('[data-testid="tuner-reference"]').exists()).toBe(true)
    expect(text()).toContain(tunerCopy.referenceHint) // TUN-94
  })

  it('clicking start shows the starting copy, then the waiting meter', async () => {
    let resolve!: (s: unknown) => void
    reinstall({ getUserMedia: () => new Promise((r) => { resolve = r }) })
    await mountPanel()
    await wrapper.find('[data-testid="tuner-start"]').trigger('click')
    expect(env.getUserMedia).toHaveBeenCalledTimes(1)
    const btn = wrapper.find('[data-testid="tuner-start"]')
    expect(btn.text()).toBe(tunerCopy.starting)
    expect(btn.attributes('disabled')).toBeDefined()
    const { FakeMediaStream } = await import('../helpers/fakeAudio')
    resolve(new FakeMediaStream())
    await flush()
    expect(wrapper.find('[data-testid="tuner-meter"]').exists()).toBe(true)
    expect(text()).toContain(tunerCopy.waiting)
  })

  it.each([
    ['NotAllowedError', tunerCopy.errors['permission-denied']],
    ['NotFoundError', tunerCopy.errors['not-found']],
    ['NotReadableError', tunerCopy.errors['not-readable']],
    ['TypeError', tunerCopy.errors.unknown],
  ])('%s shows its copy, retry and reference tones', async (name, copy) => {
    reinstall({ getUserMedia: () => Promise.reject(domError(name)) })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await mountPanel()
    await wrapper.find('[data-testid="tuner-start"]').trigger('click')
    await flush()
    expect(text()).toContain(copy)
    expect(wrapper.find('[data-testid="tuner-retry"]').text()).toBe(tunerCopy.retry)
    expect(wrapper.find('[data-testid="tuner-reference"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="in-app-hint"]').exists()).toBe(false)
  })

  it.each([
    ['iPhone', tunerCopy.permissionSteps.ios],
    ['Linux; Android 13', tunerCopy.permissionSteps.android],
    ['Windows NT 10.0', tunerCopy.permissionSteps.desktop],
  ])('permission denied on %s shows the matching steps', async (ua, step) => {
    reinstall({ getUserMedia: () => Promise.reject(domError('NotAllowedError')) })
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(`Mozilla/5.0 (${ua})`)
    await mountPanel()
    await wrapper.find('[data-testid="tuner-start"]').trigger('click')
    await flush()
    expect(wrapper.find('[data-testid="permission-step"]').text()).toBe(step)
    expect(text()).toContain(tunerCopy.permissionSteps.fallback)
  })

  it('in-app browser UA adds the open-in-browser hint on failure', async () => {
    reinstall({ getUserMedia: () => Promise.reject(domError('NotAllowedError')) })
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone) Mobile/15E148 Instagram 305.0.0.0')
    await mountPanel()
    expect(wrapper.find('[data-testid="in-app-hint"]').exists()).toBe(false) // 不預先封鎖
    await wrapper.find('[data-testid="tuner-start"]').trigger('click')
    await flush()
    expect(wrapper.find('[data-testid="in-app-hint"]').text()).toBe(tunerCopy.inAppHint)
  })

  it('insecure: no start button, copy + reference tones', async () => {
    reinstall({ secure: false })
    await mountPanel()
    expect(wrapper.find('[data-testid="tuner-start"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="tuner-retry"]').exists()).toBe(false)
    expect(text()).toContain(tunerCopy.errors.insecure)
    expect(wrapper.find('[data-testid="tuner-reference"]').exists()).toBe(true)
  })

  it('unsupported without AudioContext hides reference tones and explains', async () => {
    reinstall({ audioContext: false })
    await mountPanel()
    expect(text()).toContain(tunerCopy.errors.unsupported)
    expect(text()).toContain(tunerCopy.noAudioOutput)
    expect(wrapper.find('[data-testid="tuner-reference"]').exists()).toBe(false)
  })

  it('paused shows "tap to continue" and restarts on click', async () => {
    await mountPanel()
    await wrapper.find('[data-testid="tuner-start"]').trigger('click')
    await flush()
    env.setVisibility('hidden')
    await flush()
    expect(text()).toContain(tunerCopy.paused)
    await wrapper.find('[data-testid="tuner-retry"]').trigger('click')
    await flush()
    expect(env.getUserMedia).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="tuner-meter"]').exists()).toBe(true)
  })

  it('shows "playing reference" while a tone plays during tuning (TUN-92)', async () => {
    await mountPanel()
    await wrapper.find('[data-testid="tuner-start"]').trigger('click')
    await flush()
    await wrapper.find('[data-testid="reference-2"]').trigger('click')
    expect(wrapper.find('[data-testid="reference-banner"]').text()).toBe(tunerCopy.referencePlaying)
    expect(wrapper.find('[data-testid="tuner-announcement"]').text()).toBe(tunerCopy.referencePlaying)
  })

  it('keeps the aria-live region mounted across phases and empty before running (TUN-45)', async () => {
    await mountPanel()
    const live = () => wrapper.find('[data-testid="tuner-announcement"]')
    expect(live().exists()).toBe(true)
    expect(live().text()).toBe('')
    const el = live().element
    await wrapper.find('[data-testid="tuner-start"]').trigger('click')
    await flush()
    expect(live().element).toBe(el)
    expect(live().text()).toBe(tunerCopy.waiting)
  })
})

function viewFor(cents: number, durMs: number): TunerView {
  const d = new Driver(undefined, { medianSize: 1, emaTimeConstantMs: 1e-9 })
  d.repeat(pitched(atCents(1, cents)), durMs, 10)
  return selectTunerView(d.state)
}

describe('TunerMeter (TUN-32/40/42/43/45)', () => {
  it('inTune: green class, check icon and text together', () => {
    const view = viewFor(2, 700)
    expect(view.status).toBe('inTune')
    const w = mount(TunerMeter, { props: { view } })
    expect(w.find('.meter').classes()).toContain('is-in-tune')
    expect(w.find('[data-testid="tuner-check"]').exists()).toBe(true)
    expect(w.find('[data-testid="tuner-status"]').text()).toBe(tunerCopy.direction.inTune)
    expect(w.text()).toContain('A2')
    expect(w.find('[data-testid="tuner-cents"]').text()).toBe('+2 ¢')
  })

  it('approaching is not green and has no check', () => {
    const w = mount(TunerMeter, { props: { view: viewFor(2, 200) } })
    expect(w.find('.meter').classes()).not.toContain('is-in-tune')
    expect(w.find('.meter').classes()).toContain('is-approaching')
    expect(w.find('[data-testid="tuner-check"]').exists()).toBe(false)
    expect(w.find('[data-testid="tuner-status"]').text()).toBe(tunerCopy.direction.approaching)
  })

  it('waiting hides note and cents', () => {
    const w = mount(TunerMeter, { props: { view: selectTunerView(createInitialTunerState()) } })
    expect(w.find('[data-testid="tuner-cents"]').exists()).toBe(false)
    expect(w.find('[data-testid="tuner-status"]').text()).toBe(tunerCopy.waiting)
  })

  // 播報文字只隨狀態類別改變由 tunerView.spec（TUN-45）驗證；live region 常駐在 TunerPanel
  it('has no live region of its own (it is mounted with v-if)', () => {
    const w = mount(TunerMeter, { props: { view: viewFor(-20, 100) } })
    expect(w.findAll('[aria-live]')).toHaveLength(0)
  })
})

describe('TunerStringSelector (TUN-41/12)', () => {
  it('has 6 strings plus auto; manual shows the badge and emits selections', async () => {
    const w = mount(TunerStringSelector, { props: { activeIndex: 1, mode: { kind: 'manual', stringIndex: 1 } } })
    expect(w.findAll('button')).toHaveLength(7)
    expect(w.find('[data-testid="manual-badge"]').text()).toBe(tunerCopy.manual)
    expect(w.find('[data-testid="string-1"]').classes()).toContain('is-active')
    await w.find('[data-testid="string-auto"]').trigger('click')
    await w.find('[data-testid="string-5"]').trigger('click')
    expect(w.emitted('select')).toEqual([['auto'], [5]])

    await w.setProps({ mode: { kind: 'auto' }, activeIndex: null })
    expect(w.find('[data-testid="manual-badge"]').exists()).toBe(false)
  })
})

describe('TUN-83: privacy statement', () => {
  it('appears in the intro and in the /tuner page footer', () => {
    expect(tunerCopy.intro.body).toContain('不會錄音、不會上傳')
    expect(tunerCopy.privacy).toBe('聲音只在這支手機上分析，不會錄音、不會上傳。')
    // pages/tuner.vue 需要 Nuxt runtime（ClientOnly / useSeoMeta），以原始碼檢查頁尾綁定（ADR-006 已知限制）
    const page = readFileSync(resolve(process.cwd(), 'app/pages/tuner.vue'), 'utf8')
    expect(page).toMatch(/\{\{\s*tunerCopy\.privacy\s*\}\}/)
    expect(page.indexOf('tunerCopy.privacy')).toBeGreaterThan(page.indexOf('</ClientOnly>'))
  })
})
