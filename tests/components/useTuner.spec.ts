// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { useTuner, type UseTuner } from '~/composables/useTuner'
import { TUNER_MODE_STORAGE_KEY } from '~/utils/tuner/strings'
import { FakeAudioContext, domError, flush, installFakeAudio, type FakeEnv } from '../helpers/fakeAudio'
import { sine } from '../helpers/signals'

let env: FakeEnv
let wrapper: VueWrapper | null = null

function mountTuner(): UseTuner {
  let api!: UseTuner
  wrapper = mount(defineComponent({
    setup() {
      api = useTuner()
      return () => h('div')
    },
  }))
  return api
}

async function running(): Promise<{ api: UseTuner; ctx: FakeAudioContext }> {
  const api = mountTuner()
  await api.start()
  await flush()
  expect(api.phase.value.kind).toBe('running')
  return { api, ctx: FakeAudioContext.instances.at(-1)! }
}

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

describe('TUN-50/51/52/27: startup', () => {
  it('mounting does not request the microphone; phase goes checking → idle', () => {
    const api = mountTuner()
    expect(api.phase.value).toEqual({ kind: 'idle' })
    expect(env.getUserMedia).not.toHaveBeenCalled()
    expect(FakeAudioContext.instances).toHaveLength(0)
  })

  it('creates/resumes the AudioContext and calls getUserMedia synchronously inside start()', () => {
    const api = mountTuner()
    const p = api.start() // 不 await：以下斷言都在第一個 await 之前
    expect(FakeAudioContext.instances).toHaveLength(1)
    expect(FakeAudioContext.instances[0]!.resume).toHaveBeenCalledTimes(1)
    expect(env.getUserMedia).toHaveBeenCalledTimes(1)
    expect(api.phase.value).toEqual({ kind: 'starting' })
    return p
  })

  it('requests audio with echoCancellation / noiseSuppression / autoGainControl disabled', async () => {
    const api = mountTuner()
    await api.start()
    expect(env.getUserMedia.mock.calls[0]![0]).toEqual({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    })
  })

  it('runs the analysis loop and shows a reading for an A2 tone', async () => {
    const { api, ctx } = await running()
    const analyser = ctx.analysers[0]!
    expect(analyser.fftSize).toBe(2048)
    const tone = sine(110, 48000, 0.2)
    analyser.source = n => tone.subarray(0, n)
    for (let i = 0; i < 6; i++) env.raf.tick(i * 20)
    expect(api.view.value.noteLabel).toBe('A2')
    expect(api.view.value.centsText).toBe('0 ¢')
  })

  it('pauses as interrupted when the context will not resume', async () => {
    FakeAudioContext.resumeTo = 'suspended'
    const api = mountTuner()
    await api.start()
    await flush()
    expect(api.phase.value).toEqual({ kind: 'paused', reason: 'interrupted' })
    expect(env.lastStream()!.tracks[0]!.stop).toHaveBeenCalled()
  })
})

describe('TUN-53–55/59: start errors', () => {
  it.each([
    ['NotAllowedError', 'permission-denied'],
    ['NotFoundError', 'not-found'],
    ['OverconstrainedError', 'not-found'],
    ['NotReadableError', 'not-readable'],
    ['AbortError', 'not-readable'],
    ['TypeError', 'unknown'],
  ])('%s → error(%s)', async (name, kind) => {
    env.restore()
    env = installFakeAudio({ getUserMedia: () => Promise.reject(domError(name)) })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const api = mountTuner()
    await api.start()
    expect(api.phase.value).toEqual({ kind: 'error', error: kind, inAppBrowser: null })
    expect(warn).toHaveBeenCalledTimes(kind === 'unknown' ? 1 : 0)
  })

  it('retry calls getUserMedia again and stays on the error when still denied', async () => {
    env.restore()
    env = installFakeAudio({ getUserMedia: () => Promise.reject(domError('NotAllowedError')) })
    const api = mountTuner()
    await api.start()
    await api.start()
    expect(env.getUserMedia).toHaveBeenCalledTimes(2)
    expect(api.phase.value.kind).toBe('error')
  })

  it('adds the in-app browser flag for LINE', async () => {
    env.restore()
    env = installFakeAudio({ getUserMedia: () => Promise.reject(domError('NotAllowedError')) })
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone) Mobile/15E148 Safari Line/13.17.0')
    const api = mountTuner()
    await api.start()
    expect(api.phase.value).toMatchObject({ kind: 'error', inAppBrowser: 'line' })
  })
})

describe('TUN-56/57: environment blocking', () => {
  it('insecure context → blocked(insecure) without touching navigator.mediaDevices', async () => {
    env.restore()
    env = installFakeAudio({ secure: false })
    const api = mountTuner()
    expect(api.phase.value).toMatchObject({ kind: 'blocked', reason: 'insecure', audioOutputAvailable: true })
    await api.start()
    expect(env.mediaDevicesGetter).not.toHaveBeenCalled()
    expect(env.getUserMedia).not.toHaveBeenCalled()
  })

  it('no mediaDevices → blocked(unsupported) with audio output', () => {
    env.restore()
    env = installFakeAudio({ mediaDevices: false })
    expect(mountTuner().phase.value).toMatchObject({ kind: 'blocked', reason: 'unsupported', audioOutputAvailable: true })
  })

  it('no AudioContext → blocked(unsupported) without audio output, and reference tones do nothing', () => {
    env.restore()
    env = installFakeAudio({ audioContext: false })
    const api = mountTuner()
    expect(api.phase.value).toMatchObject({ kind: 'blocked', reason: 'unsupported', audioOutputAvailable: false })
    api.toggleReference(0)
    expect(api.referencePlaying.value).toBeNull()
  })
})

describe('TUN-60/61/62: release', () => {
  it('unmount stops every track, closes the context, cancels rAF and removes listeners', async () => {
    const { ctx } = await running()
    const track = env.lastStream()!.tracks[0]!
    const removeDoc = vi.spyOn(document, 'removeEventListener')
    const removeWin = vi.spyOn(window, 'removeEventListener')
    wrapper!.unmount()
    wrapper = null
    expect(track.stop).toHaveBeenCalled()
    expect(ctx.close).toHaveBeenCalled()
    expect(env.cancelAnimationFrame).toHaveBeenCalled()
    expect(env.raf.callbacks.size).toBe(0)
    expect(removeDoc).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    expect(removeWin).toHaveBeenCalledWith('pagehide', expect.any(Function))
  })

  it('hidden → releases and pauses; visible again does not restart', async () => {
    const { api, ctx } = await running()
    const track = env.lastStream()!.tracks[0]!
    env.setVisibility('hidden')
    expect(track.stop).toHaveBeenCalled()
    expect(ctx.close).toHaveBeenCalled()
    expect(api.phase.value).toEqual({ kind: 'paused', reason: 'hidden' })
    env.setVisibility('visible')
    await flush()
    expect(env.getUserMedia).toHaveBeenCalledTimes(1)
    expect(api.phase.value.kind).toBe('paused')
    // 點「繼續調音」才重新啟動
    await api.start()
    await flush()
    expect(env.getUserMedia).toHaveBeenCalledTimes(2)
    expect(api.phase.value.kind).toBe('running')
  })

  it('pagehide releases the microphone', async () => {
    const { ctx } = await running()
    window.dispatchEvent(new Event('pagehide'))
    expect(env.lastStream()!.tracks[0]!.stop).toHaveBeenCalled()
    expect(ctx.close).toHaveBeenCalled()
  })

  it.each(['interrupted', 'suspended'])('context state %s → paused(interrupted)', async (state) => {
    const { api, ctx } = await running()
    ctx.setState(state)
    expect(api.phase.value).toEqual({ kind: 'paused', reason: 'interrupted' })
    expect(env.lastStream()!.tracks[0]!.stop).toHaveBeenCalled()
  })

  it('track ended → paused(track-ended)', async () => {
    const { api } = await running()
    env.lastStream()!.tracks[0]!.fireEnded()
    expect(api.phase.value).toEqual({ kind: 'paused', reason: 'track-ended' })
  })

  it('unmounting while getUserMedia is pending stops the track as soon as it resolves', async () => {
    let resolve!: (s: unknown) => void
    const { FakeMediaStream } = await import('../helpers/fakeAudio')
    const stream = new FakeMediaStream()
    env.restore()
    env = installFakeAudio({ getUserMedia: () => new Promise((r) => { resolve = r }) })
    const api = mountTuner()
    const p = api.start()
    wrapper!.unmount()
    wrapper = null
    resolve(stream)
    await p
    expect(stream.tracks[0]!.stop).toHaveBeenCalled()
    expect(FakeAudioContext.instances[0]!.close).toHaveBeenCalled()
  })

  it('stop() returns to idle and releases everything', async () => {
    const { api, ctx } = await running()
    api.stop()
    expect(api.phase.value).toEqual({ kind: 'idle' })
    expect(ctx.close).toHaveBeenCalled()
    expect(env.lastStream()!.tracks[0]!.stop).toHaveBeenCalled()
  })

  it('a throw while wiring the graph after getUserMedia stops the track and shows an error', async () => {
    const api = mountTuner()
    const p = api.start()
    const ctx = FakeAudioContext.instances[0]!
    ctx.createMediaStreamSource.mockImplementation(() => {
      throw domError('NotSupportedError')
    })
    await expect(p).resolves.toBeUndefined()
    await flush()
    expect(env.lastStream()!.tracks[0]!.stop).toHaveBeenCalled()
    expect(ctx.close).toHaveBeenCalled()
    expect(api.phase.value.kind).toBe('error')
    expect(env.raf.callbacks.size).toBe(0)
  })

  it('a track that has already ended when getUserMedia resolves → paused(track-ended)', async () => {
    const { FakeMediaStream } = await import('../helpers/fakeAudio')
    const stream = new FakeMediaStream()
    stream.tracks[0]!.readyState = 'ended'
    env.restore()
    env = installFakeAudio({ getUserMedia: () => Promise.resolve(stream) })
    const api = mountTuner()
    await api.start()
    await flush()
    expect(api.phase.value).toEqual({ kind: 'paused', reason: 'track-ended' })
    expect(FakeAudioContext.instances[0]!.close).toHaveBeenCalled()
  })

  it('hidden while idle also closes a context kept for reference tones', () => {
    const api = mountTuner()
    api.toggleReference(1)
    const ctx = FakeAudioContext.instances[0]!
    env.setVisibility('hidden')
    expect(ctx.close).toHaveBeenCalled()
    expect(api.referencePlaying.value).toBeNull()
    expect(api.phase.value).toEqual({ kind: 'idle' })
  })
})

describe('TUN-15/82: mode persistence', () => {
  it('only writes the mode key and restores it on remount', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const api = mountTuner()
    api.selectString(2)
    expect(api.mode.value).toEqual({ kind: 'manual', stringIndex: 2 })
    expect(api.view.value.string?.label).toBe('D3')
    api.selectString(2) // 同一弦再點 → 自動
    expect(api.mode.value).toEqual({ kind: 'auto' })
    api.selectString(4)
    expect(setItem.mock.calls.every(([key]) => key === TUNER_MODE_STORAGE_KEY)).toBe(true)
    wrapper!.unmount()

    const again = mountTuner()
    expect(again.mode.value).toEqual({ kind: 'manual', stringIndex: 4 })
  })

  it('survives a throwing localStorage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const api = mountTuner()
    expect(api.mode.value).toEqual({ kind: 'auto' })
    api.selectString(1)
    expect(api.mode.value).toEqual({ kind: 'manual', stringIndex: 1 })
  })
})

describe('TUN-90–93: reference tones', () => {
  it('same string stops, another switches; at most one oscillator plays', async () => {
    const api = mountTuner()
    api.toggleReference(0)
    const ctx = FakeAudioContext.instances[0]!
    expect(api.referencePlaying.value).toBe(0)
    expect(ctx.oscillators[0]!.frequency.value).toBeCloseTo(82.407, 3)

    api.toggleReference(3)
    expect(api.referencePlaying.value).toBe(3)
    expect(ctx.oscillators[0]!.stoppedEarly).toBe(true)
    expect(ctx.oscillators.filter(o => !o.stoppedEarly)).toHaveLength(1)

    api.toggleReference(3)
    expect(api.referencePlaying.value).toBeNull()
    expect(ctx.oscillators.every(o => o.stoppedEarly)).toBe(true)
  })

  it('pauses detection while playing and resumes after the tone ends', async () => {
    const { api, ctx } = await running()
    const analyser = ctx.analysers[0]!
    const tone = sine(110, 48000, 0.2)
    analyser.source = n => tone.subarray(0, n)
    for (let i = 0; i < 6; i++) env.raf.tick(i * 20)
    expect(api.view.value.status).not.toBe('waiting')

    api.toggleReference(1)
    expect(api.view.value.status).toBe('waiting') // suspend
    analyser.getFloatTimeDomainData.mockClear()
    for (let i = 6; i < 12; i++) env.raf.tick(i * 20)
    expect(analyser.getFloatTimeDomainData).not.toHaveBeenCalled()

    ctx.oscillators[0]!.end()
    await flush()
    expect(api.referencePlaying.value).toBeNull()
    // 尾音緩衝（淡出 + 輸出延遲 + 150 ms）內仍不分析，避免把參考音當成撥弦
    env.raf.tick(12 * 20)
    expect(analyser.getFloatTimeDomainData).not.toHaveBeenCalled()

    const later = performance.now() + 1000
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(later)
    try {
      for (let i = 13; i < 19; i++) env.raf.tick(i * 20)
    }
    finally {
      nowSpy.mockRestore()
    }
    expect(analyser.getFloatTimeDomainData).toHaveBeenCalled()
    expect(api.view.value.noteLabel).toBe('A2')
  })

  it.each([
    ['idle', {}],
    ['error', { getUserMedia: () => Promise.reject(domError('NotAllowedError')) }],
    ['blocked(insecure)', { secure: false }],
  ] as const)('plays in %s without the microphone', async (_, opts) => {
    env.restore()
    env = installFakeAudio(opts)
    const api = mountTuner()
    if (_ === 'error') await api.start()
    const calls = env.getUserMedia.mock.calls.length
    api.toggleReference(5)
    expect(api.referencePlaying.value).toBe(5)
    expect(FakeAudioContext.instances.at(-1)!.oscillators).toHaveLength(1)
    expect(env.getUserMedia.mock.calls.length).toBe(calls)
  })

  it('a context created for the reference tone is reused by start()', async () => {
    const api = mountTuner()
    api.toggleReference(0)
    await api.start()
    await flush()
    expect(FakeAudioContext.instances).toHaveLength(1)
    expect(api.phase.value.kind).toBe('running')
  })
})
