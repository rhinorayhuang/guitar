// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, watch } from 'vue'
import { useMetronome, type UseMetronome } from '~/composables/useMetronome'
import { FakeAudioContext, flush, installFakeAudio, liveOscillators, startTimes, type FakeEnv } from '../helpers/fakeAudio'

let env: FakeEnv
let wrapper: VueWrapper | null = null

interface FakeSentinel { release: ReturnType<typeof vi.fn>; addEventListener: ReturnType<typeof vi.fn>; fireRelease(): void }
let wakeLock: { request: ReturnType<typeof vi.fn> } | undefined
let sentinels: FakeSentinel[]

function makeSentinel(): FakeSentinel {
  const listeners: (() => void)[] = []
  return {
    release: vi.fn(() => Promise.resolve()),
    addEventListener: vi.fn((type: string, fn: () => void) => {
      if (type === 'release') listeners.push(fn)
    }),
    fireRelease: () => listeners.forEach(fn => fn()),
  }
}

function installWakeLock(request?: () => Promise<unknown>) {
  wakeLock = {
    request: vi.fn(request ?? (() => {
      const s = makeSentinel()
      sentinels.push(s)
      return Promise.resolve(s)
    })),
  }
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: wakeLock })
}

function mountMetronome(opts?: { initialBpm?: number }): UseMetronome {
  let api!: UseMetronome
  wrapper = mount(defineComponent({
    setup() {
      api = useMetronome(opts)
      return () => h('div')
    },
  }))
  return api
}

const ctxOf = () => FakeAudioContext.instances.at(-1)!

async function running(opts?: { initialBpm?: number }) {
  const api = mountMetronome(opts)
  await api.start()
  await flush()
  expect(api.phase.value).toEqual({ kind: 'running' })
  return { api, ctx: ctxOf() }
}

/** 每 25 ms：音訊時間前進並觸發一次計時器 */
function run(ctx: FakeAudioContext, seconds: number) {
  const n = Math.round(seconds / 0.025)
  for (let i = 0; i < n; i++) {
    ctx.advance(0.025)
    vi.advanceTimersByTime(25)
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  env = installFakeAudio()
  sentinels = []
  installWakeLock()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  env.restore()
  delete (navigator as unknown as Record<string, unknown>).wakeLock
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useMetronome: startup (§9.4 #1–#4)', () => {
  it('mount: checking → idle without creating an AudioContext', () => {
    const api = mountMetronome()
    expect(api.phase.value).toEqual({ kind: 'idle' })
    expect(api.available.value).toBe(true)
    expect(api.isPlaying.value).toBe(false)
    expect(api.bpm.value).toBe(60)
    expect(api.currentBeat.value).toBeNull()
    expect(FakeAudioContext.instances).toHaveLength(0)
  })

  it('without AudioContext → unsupported, not available, start() is a no-op', async () => {
    env.restore()
    env = installFakeAudio({ audioContext: false })
    const api = mountMetronome()
    expect(api.phase.value).toEqual({ kind: 'unsupported' })
    expect(api.available.value).toBe(false)
    await api.start()
    expect(api.phase.value).toEqual({ kind: 'unsupported' })
  })

  it('gesture rule: start() creates and resumes the context synchronously', () => {
    const api = mountMetronome()
    const p = api.start() // 不 await：以下斷言都在第一個 await 之前
    expect(FakeAudioContext.instances).toHaveLength(1)
    expect(ctxOf().resume).toHaveBeenCalledTimes(1)
    expect(api.phase.value).toEqual({ kind: 'starting' })
    expect(api.isPlaying.value).toBe(true)
    return p
  })

  it('first click at currentTime + 0.1 is the accent (1500 Hz); beats 2–4 are 1000 Hz; beat 5 accent again', async () => {
    const { ctx } = await running()
    expect(ctx.oscillators[0]!.startAt).toBeCloseTo(0.1, 12)
    run(ctx, 4.2)
    const freqs = ctx.oscillators.slice(0, 5).map(o => o.frequency.value)
    expect(freqs).toEqual([1500, 1000, 1000, 1000, 1500])
    expect(ctx.oscillators.every(o => o.type === 'triangle')).toBe(true)
  })

  it('initialBpm is clamped', () => {
    expect(mountMetronome({ initialBpm: 300 }).bpm.value).toBe(200)
  })
})

describe('useMetronome: time series (§9.4 #5–#8)', () => {
  it('60 BPM for 60 s: oscillator start times exactly 1.0 apart; stop = start + duration + 0.005', async () => {
    const { ctx } = await running()
    run(ctx, 60)
    const ts = startTimes(ctx)
    expect(ts.length).toBeGreaterThanOrEqual(60)
    for (let i = 1; i < ts.length; i++) expect(Math.abs(ts[i]! - ts[i - 1]! - 1)).toBeLessThan(1e-9)
    ctx.oscillators.forEach((o, i) => {
      const duration = i % 4 === 0 ? 0.05 : 0.04
      expect(o.stopAt).toBeCloseTo(o.startAt! + duration + 0.005, 12)
    })
  })

  it('node recycling over 5 minutes: ≤ 3 live oscillators; ended nodes are disconnected', async () => {
    const { ctx } = await running({ initialBpm: 200 })
    let maxLive = 0
    for (let i = 0; i < (5 * 60) / 0.025; i++) {
      ctx.advance(0.025)
      vi.advanceTimersByTime(25)
      maxLive = Math.max(maxLive, liveOscillators(ctx).length)
    }
    expect(ctx.oscillators.length).toBeGreaterThan(900)
    expect(maxLive).toBeLessThanOrEqual(3)
    const ended = ctx.oscillators.filter(o => o.ended)
    expect(ended.length).toBeGreaterThan(900)
    for (const o of ended) expect(o.disconnect).toHaveBeenCalled()
    // gains[0] 是 master；其餘是每個 click 的包絡
    const clickGains = ctx.gains.slice(1)
    const endedGains = clickGains.filter((_, i) => ctx.oscillators[i]!.ended)
    for (const g of endedGains) expect(g.disconnect).toHaveBeenCalled()
  })

  it('setBpm(120) while playing: existing clicks unchanged, next click 0.5 s after the previous', async () => {
    const { api, ctx } = await running()
    run(ctx, 2.05)
    const before = startTimes(ctx)
    api.setBpm(120)
    expect(api.bpm.value).toBe(120)
    run(ctx, 3)
    const after = startTimes(ctx)
    expect(after.slice(0, before.length)).toEqual(before)
    const fresh = after.slice(before.length - 1)
    expect(fresh.length).toBeGreaterThan(3)
    for (let i = 1; i < fresh.length; i++) expect(fresh[i]! - fresh[i - 1]!).toBeCloseTo(0.5, 9)
  })

  it('timer delay: after a 1.5 s stall no click is scheduled in the past (skip, no catch-up)', async () => {
    const { ctx } = await running()
    run(ctx, 1)
    const n = ctx.oscillators.length
    ctx.advance(1.5)
    vi.advanceTimersByTime(25)
    const fresh = ctx.oscillators.slice(n)
    for (const o of fresh) expect(o.startAt!).toBeGreaterThanOrEqual(ctx.currentTime - 0.01)
    run(ctx, 3)
    // 之後仍在原本 1 s 格線上
    for (const t of startTimes(ctx)) expect(Math.abs((t - 0.1) - Math.round(t - 0.1))).toBeLessThan(1e-9)
  })
})

describe('useMetronome: BPM and playAt (§9.4 #9–#10, D-M1)', () => {
  it('setBpm clamps; nudgeBpm saturates; idle changes never create a context', () => {
    const api = mountMetronome()
    api.setBpm(25)
    expect(api.bpm.value).toBe(30)
    api.setBpm(198)
    api.nudgeBpm(5)
    expect(api.bpm.value).toBe(200)
    api.nudgeBpm(-1)
    expect(api.bpm.value).toBe(199)
    expect(FakeAudioContext.instances).toHaveLength(0)
  })

  it('playAt(70) while idle starts at 70 BPM', async () => {
    const api = mountMetronome()
    await api.playAt(70)
    await flush()
    expect(api.phase.value).toEqual({ kind: 'running' })
    expect(api.bpm.value).toBe(70)
    expect(FakeAudioContext.instances).toHaveLength(1)
    const ctx = ctxOf()
    run(ctx, 2)
    const ts = startTimes(ctx)
    expect(ts[1]! - ts[0]!).toBeCloseTo(60 / 70, 9)
  })

  it('playAt(50) while running only changes tempo (no second context)', async () => {
    const { api, ctx } = await running({ initialBpm: 70 })
    run(ctx, 1)
    const r = api.playAt(50)
    expect(r).toBeUndefined()
    expect(FakeAudioContext.instances).toHaveLength(1)
    expect(api.bpm.value).toBe(50)
    expect(api.phase.value).toEqual({ kind: 'running' })
    expect(ctx.close).not.toHaveBeenCalled()
  })

  it('playAt from paused restarts', async () => {
    const { api } = await running()
    env.setVisibility('hidden')
    env.setVisibility('visible')
    expect(api.phase.value).toEqual({ kind: 'paused', reason: 'hidden' })
    await api.playAt(66)
    await flush()
    expect(api.phase.value).toEqual({ kind: 'running' })
    expect(FakeAudioContext.instances).toHaveLength(2)
  })
})

describe('useMetronome: races and release (§9.4 #11–#19)', () => {
  it('double start() → one context', async () => {
    const api = mountMetronome()
    const a = api.start()
    const b = api.start()
    await Promise.all([a, b])
    expect(FakeAudioContext.instances).toHaveLength(1)
  })

  it('stop() before resume resolves: nothing scheduled, context closed, idle', async () => {
    const api = mountMetronome()
    const p = api.start()
    api.stop()
    await p
    await flush()
    const ctx = ctxOf()
    expect(ctx.oscillators).toHaveLength(0)
    expect(ctx.close).toHaveBeenCalled()
    expect(api.phase.value).toEqual({ kind: 'idle' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('resume failure → paused(interrupted), context closed', async () => {
    FakeAudioContext.resumeTo = 'suspended'
    const api = mountMetronome()
    await api.start()
    await flush()
    expect(api.phase.value).toEqual({ kind: 'paused', reason: 'interrupted' })
    expect(ctxOf().close).toHaveBeenCalled()
    expect(ctxOf().oscillators).toHaveLength(0)
  })

  it('stop(): silences live clicks, disconnects master, cancels rAF, closes ctx, clears beat and timers', async () => {
    const { api, ctx } = await running()
    run(ctx, 2.03)
    env.raf.tick(1000)
    expect(api.currentBeat.value).not.toBeNull()
    const live = liveOscillators(ctx)
    expect(live.length).toBeGreaterThan(0)
    api.stop()
    for (const o of live) expect(o.stopAt!).toBeLessThanOrEqual(ctx.currentTime)
    expect(ctx.gains[0]!.disconnect).toHaveBeenCalled()
    expect(env.cancelAnimationFrame).toHaveBeenCalled()
    expect(ctx.close).toHaveBeenCalled()
    expect(api.currentBeat.value).toBeNull()
    expect(api.phase.value).toEqual({ kind: 'idle' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('start → stop → start with the first resume resolving late: one running context, the first closed and silent', async () => {
    let resolveFirst!: () => void
    const firstResume = new Promise<void>((r) => { resolveFirst = r })
    class LateFirst extends FakeAudioContext {
      constructor() {
        super()
        if (FakeAudioContext.instances.length === 1) {
          this.resume = vi.fn(() => firstResume.then(() => {
            if (this.state !== 'closed') this.state = 'running'
          }))
        }
      }
    }
    ;(window as unknown as { AudioContext: unknown }).AudioContext = LateFirst

    const api = mountMetronome()
    const p1 = api.start()
    api.stop()
    const p2 = api.start()
    await p2
    await flush()
    resolveFirst()
    await p1
    await flush()

    const [first, second] = FakeAudioContext.instances
    expect(FakeAudioContext.instances).toHaveLength(2)
    expect(first!.close).toHaveBeenCalled()
    expect(first!.oscillators).toHaveLength(0)
    expect(FakeAudioContext.instances.filter(c => c.state === 'running')).toEqual([second])
    expect(api.phase.value).toEqual({ kind: 'running' })
  })

  it('start after stop creates a new context', async () => {
    const { api } = await running()
    api.stop()
    await api.start()
    await flush()
    expect(FakeAudioContext.instances).toHaveLength(2)
    expect(api.phase.value).toEqual({ kind: 'running' })
  })

  it('toggle() starts and stops', async () => {
    const api = mountMetronome()
    await api.toggle()
    await flush()
    expect(api.phase.value).toEqual({ kind: 'running' })
    api.toggle()
    expect(api.phase.value).toEqual({ kind: 'idle' })
  })

  it('visibility hidden → teardown + paused(hidden); visible again does not restart', async () => {
    const { api, ctx } = await running()
    env.setVisibility('hidden')
    expect(api.phase.value).toEqual({ kind: 'paused', reason: 'hidden' })
    expect(ctx.close).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    const n = ctx.oscillators.length
    env.setVisibility('visible')
    run(ctx, 2)
    expect(FakeAudioContext.instances).toHaveLength(1)
    expect(ctx.oscillators.length).toBe(n)
    expect(api.phase.value).toEqual({ kind: 'paused', reason: 'hidden' })
  })

  it('visibility hidden while starting → paused(hidden) and the pending start does nothing', async () => {
    const api = mountMetronome()
    const p = api.start()
    env.setVisibility('hidden')
    await p
    await flush()
    expect(api.phase.value).toEqual({ kind: 'paused', reason: 'hidden' })
    expect(ctxOf().oscillators).toHaveLength(0)
  })

  it('pagehide → teardown', async () => {
    const { api, ctx } = await running()
    window.dispatchEvent(new Event('pagehide'))
    expect(ctx.close).toHaveBeenCalled()
    expect(api.isPlaying.value).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('unmount → teardown, listeners removed, no timers left', async () => {
    const removeDoc = vi.spyOn(document, 'removeEventListener')
    const removeWin = vi.spyOn(window, 'removeEventListener')
    const { ctx } = await running()
    wrapper!.unmount()
    wrapper = null
    expect(ctx.close).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(removeDoc).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    expect(removeWin).toHaveBeenCalledWith('pagehide', expect.any(Function))
    expect(env.raf.callbacks.size).toBe(0)
  })

  it('context interrupted (iOS call) → paused(interrupted)', async () => {
    const { api, ctx } = await running()
    ctx.setState('interrupted')
    expect(api.phase.value).toEqual({ kind: 'paused', reason: 'interrupted' })
    expect(ctx.close).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('useMetronome: visual sync (§9.4 #20–#22)', () => {
  it('fallback latency: beat lights only once currentTime − outputLatency reaches the click', async () => {
    const api = mountMetronome()
    const p = api.start()
    ctxOf().outputLatency = 0.1
    await p
    await flush()
    const ctx = ctxOf()
    const T = ctx.oscillators[0]!.startAt!
    ctx.currentTime = T + 0.05
    env.raf.tick(1)
    expect(api.currentBeat.value).toBeNull()
    ctx.currentTime = T + 0.11
    env.raf.tick(2)
    expect(api.currentBeat.value).toBe(0)
  })

  it('getOutputTimestamp: audible T − 1 ms keeps the previous beat; T + 1 ms switches', async () => {
    const { api, ctx } = await running()
    run(ctx, 1.0) // 步 1 @ 1.1 已排
    const T = ctx.oscillators[1]!.startAt!
    ctx.currentTime = T + 0.05 // 可聽時間不會超過 currentTime
    ctx.getOutputTimestamp = () => ({ contextTime: T - 0.101, performanceTime: 1000 })
    env.raf.tick(1100) // contextTime + 0.1 = T − 0.001
    expect(api.currentBeat.value).toBe(0)
    ctx.getOutputTimestamp = () => ({ contextTime: T - 0.099, performanceTime: 1000 })
    env.raf.tick(1100) // T + 0.001
    expect(api.currentBeat.value).toBe(1)
  })

  it('currentBeat is written only when the beat changes (watch fires once per beat)', async () => {
    const { api, ctx } = await running()
    let fires = 0
    const stopWatch = watch(api.currentBeat, () => fires++, { flush: 'sync' })
    for (let i = 0; i < 400; i++) { // 10 s，每 25 ms 一個畫面
      ctx.advance(0.025)
      vi.advanceTimersByTime(25)
      env.raf.tick(i * 25)
    }
    stopWatch()
    const heard = startTimes(ctx).filter(t => t <= ctx.currentTime).length
    expect(fires).toBe(heard)
  })

  it('the rAF loop also wakes the scheduler (timer throttled)', async () => {
    const { ctx } = await running()
    for (let i = 0; i < 200; i++) {
      ctx.advance(0.025)
      env.raf.tick(i * 25) // 不推進計時器
    }
    expect(ctx.oscillators.length).toBeGreaterThanOrEqual(5)
  })
})

describe('useMetronome: Screen Wake Lock (D-M2)', () => {
  it('acquires a screen wake lock once playing and releases it on stop', async () => {
    const { api } = await running()
    expect(wakeLock!.request).toHaveBeenCalledTimes(1)
    expect(wakeLock!.request).toHaveBeenCalledWith('screen')
    await flush()
    api.stop()
    expect(sentinels[0]!.release).toHaveBeenCalledTimes(1)
  })

  it('does not request while idle or when start fails', async () => {
    FakeAudioContext.resumeTo = 'suspended'
    const api = mountMetronome()
    expect(wakeLock!.request).not.toHaveBeenCalled()
    await api.start()
    await flush()
    expect(wakeLock!.request).not.toHaveBeenCalled()
  })

  it('releases on hidden and does not re-acquire when visible again', async () => {
    await running()
    await flush()
    env.setVisibility('hidden')
    expect(sentinels[0]!.release).toHaveBeenCalled()
    env.setVisibility('visible')
    await flush()
    expect(wakeLock!.request).toHaveBeenCalledTimes(1)
  })

  it('releases on unmount', async () => {
    await running()
    await flush()
    wrapper!.unmount()
    wrapper = null
    expect(sentinels[0]!.release).toHaveBeenCalled()
  })

  it('a lock that resolves after stop is released immediately', async () => {
    let resolve!: (s: unknown) => void
    installWakeLock(() => new Promise((r) => {
      resolve = r
    }))
    const { api } = await running()
    api.stop()
    const late = makeSentinel()
    resolve(late)
    await flush()
    expect(late.release).toHaveBeenCalled()
  })

  it('a system release (page hidden) is tolerated; stop does not release twice', async () => {
    const { api } = await running()
    await flush()
    sentinels[0]!.fireRelease()
    api.stop()
    expect(sentinels[0]!.release).not.toHaveBeenCalled()
  })

  it('unsupported or rejected wake lock is silently ignored', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    installWakeLock(() => Promise.reject(Object.assign(new Error('NotAllowedError'), { name: 'NotAllowedError' })))
    const first = await running()
    await flush()
    expect(first.api.phase.value).toEqual({ kind: 'running' })
    first.api.stop()
    wrapper!.unmount()
    wrapper = null

    delete (navigator as unknown as Record<string, unknown>).wakeLock
    const second = await running()
    expect(second.api.phase.value).toEqual({ kind: 'running' })
    installWakeLock(() => {
      throw new Error('sync throw')
    })
    second.api.stop()
    await second.api.start()
    await flush()
    expect(second.api.phase.value).toEqual({ kind: 'running' })
    expect(warn).not.toHaveBeenCalled()
  })
})
