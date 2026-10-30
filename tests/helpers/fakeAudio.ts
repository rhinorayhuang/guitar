import { vi } from 'vitest'

/** Web Audio / getUserMedia 的可控替身（C 測試用，happy-dom 環境） */

type Listener = () => void

export class FakeTrack {
  readyState: 'live' | 'ended' = 'live'
  stop = vi.fn(() => {
    this.readyState = 'ended'
  })

  private listeners = new Set<Listener>()
  addEventListener = vi.fn((type: string, fn: Listener) => {
    if (type === 'ended') this.listeners.add(fn)
  })

  removeEventListener = vi.fn((type: string, fn: Listener) => {
    if (type === 'ended') this.listeners.delete(fn)
  })

  /** 模擬裝置被拔除 / 被其他 App 搶走 */
  fireEnded() {
    this.readyState = 'ended'
    for (const fn of [...this.listeners]) fn()
  }
}

export class FakeMediaStream {
  tracks = [new FakeTrack()]
  getTracks() {
    return this.tracks
  }
}

export class FakeParam {
  value = 0
  setValueAtTime = vi.fn((v: number) => {
    this.value = v
  })

  linearRampToValueAtTime = vi.fn()
  exponentialRampToValueAtTime = vi.fn()
  setTargetAtTime = vi.fn()
  cancelScheduledValues = vi.fn()
  // 刻意不提供 cancelAndHoldAtTime：調音器測試以「沒有它」驗證 fallback 路徑，需要時由測試自行指定
}

export class FakeOscillator {
  type: string = 'sine'
  frequency = new FakeParam()
  onended: (() => void) | null = null
  ended = false
  setPeriodicWave = vi.fn()
  connect = vi.fn()
  disconnect = vi.fn()
  start = vi.fn()
  stop = vi.fn()

  /** start 第一次呼叫的參數 */
  get startAt(): number | undefined {
    return this.start.mock.calls[0]?.[0] as number | undefined
  }

  /** 最後一次 stop 的參數 */
  get stopAt(): number | undefined {
    return this.stop.mock.calls.at(-1)?.[0] as number | undefined
  }

  /** start 時會排程一次 stop(end)；第二次呼叫代表被提前停止 */
  get stoppedEarly() {
    return this.stop.mock.calls.length > 1
  }

  /** 模擬播放結束 */
  end() {
    this.ended = true
    this.onended?.()
  }
}

export class FakeGain {
  gain = new FakeParam()
  connect = vi.fn()
  disconnect = vi.fn()
}

export class FakeAnalyser {
  fftSize = 2048
  smoothingTimeConstant = 0.8
  /** 測試設定的輸入來源；回傳要填入的樣本 */
  source: ((n: number) => Float32Array) | null = null
  getFloatTimeDomainData = vi.fn((buf: Float32Array) => {
    if (this.source) buf.set(this.source(buf.length).subarray(0, buf.length))
    else buf.fill(0)
  })

  connect = vi.fn()
  disconnect = vi.fn()
}

export class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  state: string = 'suspended'
  sampleRate = 48000
  currentTime = 0
  destination = {}
  onstatechange: (() => void) | null = null
  /** 未設定時為 undefined（模擬不支援的瀏覽器） */
  outputLatency: number | undefined = undefined
  baseLatency: number | undefined = undefined
  /** 測試指定時才存在（模擬 getOutputTimestamp 支援） */
  getOutputTimestamp: (() => { contextTime: number; performanceTime: number }) | undefined = undefined
  analysers: FakeAnalyser[] = []
  oscillators: FakeOscillator[] = []
  gains: FakeGain[] = []
  sources: { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = []

  constructor() {
    FakeAudioContext.instances.push(this)
  }

  resume = vi.fn(() => {
    if (this.state !== 'closed') this.state = FakeAudioContext.resumeTo
    return Promise.resolve()
  })

  close = vi.fn(() => {
    this.state = 'closed'
    return Promise.resolve()
  })

  createMediaStreamSource = vi.fn(() => {
    const s = { connect: vi.fn(), disconnect: vi.fn() }
    this.sources.push(s)
    return s
  })

  createAnalyser = vi.fn(() => {
    const a = new FakeAnalyser()
    this.analysers.push(a)
    return a
  })

  createOscillator = vi.fn(() => {
    const o = new FakeOscillator()
    this.oscillators.push(o)
    return o
  })

  createGain = vi.fn(() => {
    const g = new FakeGain()
    this.gains.push(g)
    return g
  })

  createPeriodicWave = vi.fn(() => ({}))

  /** 推進音訊時間；stopAt 已到的 oscillator 視為播完（觸發 onended） */
  advance(dt: number) {
    this.currentTime += dt
    for (const o of this.oscillators) {
      const stopAt = o.stopAt
      if (!o.ended && stopAt !== undefined && stopAt <= this.currentTime) o.end()
    }
  }

  /** 模擬系統改變狀態（例如 iOS 來電 → interrupted） */
  setState(state: string) {
    this.state = state
    this.onstatechange?.()
  }

  /** resume() 後的狀態（模擬 resume 失敗時設成 'suspended'） */
  static resumeTo = 'running'
}

export interface FakeEnv {
  getUserMedia: ReturnType<typeof vi.fn>
  mediaDevicesGetter: ReturnType<typeof vi.fn>
  raf: { callbacks: Map<number, FrameRequestCallback>; tick(t: number): void }
  cancelAnimationFrame: ReturnType<typeof vi.fn>
  setVisibility(state: 'visible' | 'hidden'): void
  lastStream(): FakeMediaStream | undefined
  restore(): void
}

/** 安裝 fake 全域；回傳控制介面。getUserMedia 預設 resolve 一個新的 FakeMediaStream */
export function installFakeAudio(opts: {
  secure?: boolean
  mediaDevices?: boolean
  audioContext?: boolean
  getUserMedia?: () => Promise<unknown>
} = {}): FakeEnv {
  FakeAudioContext.instances = []
  FakeAudioContext.resumeTo = 'running'
  const streams: FakeMediaStream[] = []
  const getUserMedia = vi.fn(opts.getUserMedia ?? (() => {
    const s = new FakeMediaStream()
    streams.push(s)
    return Promise.resolve(s)
  }))
  const mediaDevices = { getUserMedia }
  const mediaDevicesGetter = vi.fn(() => (opts.mediaDevices === false ? undefined : mediaDevices))

  const w = window as unknown as Record<string, unknown>
  const saved = { AudioContext: w.AudioContext, webkitAudioContext: w.webkitAudioContext, raf: window.requestAnimationFrame, caf: window.cancelAnimationFrame }

  Object.defineProperty(window, 'isSecureContext', { configurable: true, get: () => opts.secure !== false })
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, get: mediaDevicesGetter })
  w.AudioContext = opts.audioContext === false ? undefined : FakeAudioContext
  w.webkitAudioContext = undefined

  let nextId = 1
  const callbacks = new Map<number, FrameRequestCallback>()
  const requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
    const id = nextId++
    callbacks.set(id, cb)
    return id
  })
  const cancelAnimationFrame = vi.fn((id: number) => {
    callbacks.delete(id)
  })
  window.requestAnimationFrame = requestAnimationFrame
  window.cancelAnimationFrame = cancelAnimationFrame
  globalThis.requestAnimationFrame = requestAnimationFrame
  globalThis.cancelAnimationFrame = cancelAnimationFrame

  let visibility: 'visible' | 'hidden' = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })

  return {
    getUserMedia,
    mediaDevicesGetter,
    cancelAnimationFrame,
    raf: {
      callbacks,
      tick(t: number) {
        const pending = [...callbacks.entries()]
        callbacks.clear()
        for (const [, cb] of pending) cb(t)
      },
    },
    setVisibility(state) {
      visibility = state
      document.dispatchEvent(new Event('visibilitychange'))
    },
    lastStream: () => streams.at(-1),
    restore() {
      w.AudioContext = saved.AudioContext
      w.webkitAudioContext = saved.webkitAudioContext
      window.requestAnimationFrame = saved.raf
      window.cancelAnimationFrame = saved.caf
      globalThis.requestAnimationFrame = saved.raf
      globalThis.cancelAnimationFrame = saved.caf
    },
  }
}

/** 所有 oscillator 的 startAt（建立順序） */
export const startTimes = (ctx: FakeAudioContext): number[] =>
  ctx.oscillators.map(o => o.startAt).filter((t): t is number => t !== undefined)

/** 尚未 end() 的 oscillator */
export const liveOscillators = (ctx: FakeAudioContext): FakeOscillator[] => ctx.oscillators.filter(o => !o.ended)

export function domError(name: string): Error {
  const e = new Error(name)
  e.name = name
  return e
}

/** 讓 pending 的 promise 鏈跑完 */
export const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}
