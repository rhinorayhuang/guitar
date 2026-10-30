// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref, type Ref } from 'vue'
import MetronomeBeatIndicator from '~/components/metronome/MetronomeBeatIndicator.vue'
import MetronomePanel from '~/components/metronome/MetronomePanel.vue'
import type { MetronomePhase, UseMetronome } from '~/composables/useMetronome'
import { audioCopy } from '~/data/audio-copy'
import { metronomeCopy } from '~/data/metronome-copy'
import { tunerCopy } from '~/data/tuner-copy'
import { flush } from '../helpers/fakeAudio'

/** 可控的 UseMetronome 替身：元件測試只驗證呈現與事件 */
function fakeMetronome(init: { phase?: MetronomePhase; bpm?: number; beat?: number | null } = {}) {
  const phase = ref<MetronomePhase>(init.phase ?? { kind: 'idle' })
  const bpm = ref(init.bpm ?? 60)
  const currentBeat = ref<number | null>(init.beat ?? null)
  const api: UseMetronome = {
    phase,
    bpm,
    currentBeat,
    available: computed(() => phase.value.kind !== 'checking' && phase.value.kind !== 'unsupported'),
    isPlaying: computed(() => phase.value.kind === 'starting' || phase.value.kind === 'running'),
    beatsPerBar: 4,
    start: vi.fn(() => Promise.resolve()),
    stop: vi.fn(),
    toggle: vi.fn(),
    setBpm: vi.fn(),
    nudgeBpm: vi.fn((d: number) => {
      bpm.value = Math.min(200, Math.max(30, bpm.value + d))
    }),
    playAt: vi.fn(),
  }
  return { api, phase: phase as Ref<MetronomePhase>, bpm, currentBeat }
}

let wrapper: VueWrapper | null = null
const find = (id: string) => wrapper!.find(`[data-testid="${id}"]`)

function mountPanel(m: UseMetronome, label: string | null = null) {
  wrapper = mount(MetronomePanel, { props: { metronome: m, label } })
  return wrapper
}

beforeEach(() => {
  wrapper = null
})

afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})

describe('MetronomePanel (§9.4)', () => {
  it('shows the BPM and the optional stage label', () => {
    const { api } = fakeMetronome({ bpm: 72 })
    mountPanel(api, metronomeCopy.stageTarget(3))
    expect(find('metronome-bpm').text()).toContain('72')
    expect(find('metronome-bpm').attributes('aria-live')).toBe('polite')
    expect(find('metronome-label').text()).toContain('第 3 關目標速度')
  })

  it('±1 / ±5 call nudgeBpm and emit manual-change', async () => {
    const { api } = fakeMetronome()
    mountPanel(api)
    await find('metronome-minus-5').trigger('click')
    await find('metronome-minus-1').trigger('click')
    await find('metronome-plus-1').trigger('click')
    await find('metronome-plus-5').trigger('click')
    expect((api.nudgeBpm as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0])).toEqual([-5, -1, 1, 5])
    expect(wrapper!.emitted('manual-change')).toHaveLength(4)
    expect(find('metronome-minus-5').attributes('aria-label')).toBe('減少 5 BPM')
    expect(find('metronome-plus-1').attributes('aria-label')).toBe('增加 1 BPM')
  })

  it('disables the minus buttons at 30 and the plus buttons at 200', async () => {
    const { api, bpm } = fakeMetronome({ bpm: 30 })
    mountPanel(api)
    expect(find('metronome-minus-1').attributes('disabled')).toBeDefined()
    expect(find('metronome-minus-5').attributes('disabled')).toBeDefined()
    expect(find('metronome-plus-1').attributes('disabled')).toBeUndefined()
    bpm.value = 200
    await flush()
    expect(find('metronome-plus-1').attributes('disabled')).toBeDefined()
    expect(find('metronome-plus-5').attributes('disabled')).toBeDefined()
    expect(find('metronome-minus-1').attributes('disabled')).toBeUndefined()
  })

  it('play button toggles, reflects aria-pressed and text per phase', async () => {
    const { api, phase } = fakeMetronome()
    mountPanel(api)
    const btn = () => find('metronome-toggle')
    expect(btn().attributes('aria-pressed')).toBe('false')
    expect(btn().text()).toBe(metronomeCopy.start)
    await btn().trigger('click')
    expect(api.toggle).toHaveBeenCalledTimes(1)
    phase.value = { kind: 'running' }
    await flush()
    expect(btn().attributes('aria-pressed')).toBe('true')
    expect(btn().text()).toBe(metronomeCopy.stop)
    phase.value = { kind: 'paused', reason: 'hidden' }
    await flush()
    expect(btn().text()).toBe(metronomeCopy.paused)
    expect(btn().text()).toContain('點一下繼續')
    expect(btn().attributes('aria-pressed')).toBe('false')
  })

  it('controls are disabled while checking', () => {
    const { api } = fakeMetronome({ phase: { kind: 'checking' } })
    mountPanel(api)
    expect(find('metronome-toggle').attributes('disabled')).toBeDefined()
    expect(find('metronome-plus-1').attributes('disabled')).toBeDefined()
  })

  it('silent-mode hint equals the shared copy (same as the tuner, TUN-94)', () => {
    const { api } = fakeMetronome()
    mountPanel(api)
    expect(find('metronome-hint').text()).toBe(audioCopy.silentModeHint)
    expect(audioCopy.silentModeHint).toBe(tunerCopy.referenceHint)
  })

  it('4 dots; currentBeat = 2 marks the third active and the first as accent; container aria-hidden', () => {
    const { api } = fakeMetronome({ beat: 2 })
    mountPanel(api)
    const beats = find('metronome-beats')
    expect(beats.attributes('aria-hidden')).toBe('true')
    const dots = beats.findAll('.dot')
    expect(dots).toHaveLength(4)
    expect(dots[2]!.classes()).toContain('is-active')
    expect(dots.filter(d => d.classes().includes('is-active'))).toHaveLength(1)
    expect(dots[0]!.classes()).toContain('is-accent')
    expect(beats.text()).toContain('第 3 拍')
  })

  it('no dot is active before the first beat is heard', () => {
    const w = mount(MetronomeBeatIndicator, { props: { currentBeat: null, beatsPerBar: 4 } })
    expect(w.findAll('.dot.is-active')).toHaveLength(0)
    w.unmount()
  })

  it('unsupported shows the unsupported copy instead of controls', () => {
    const { api } = fakeMetronome({ phase: { kind: 'unsupported' } })
    mountPanel(api)
    expect(find('metronome-unsupported').text()).toBe(metronomeCopy.unsupported)
    expect(find('metronome-toggle').exists()).toBe(false)
  })
})
