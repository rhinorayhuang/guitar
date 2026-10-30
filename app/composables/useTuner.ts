import { onBeforeUnmount, onMounted, readonly, ref, shallowRef, type Ref } from 'vue'
import {
  MIC_CONSTRAINTS, connectMicrophone, getAudioContextCtor, playReferenceTone, readEnvironment,
  type MicInput, type ToneHandle,
} from '~/composables/tuner/audioGraph'
import {
  checkEnvironment, classifyStartError, detectInAppBrowser, type InAppBrowser, type TunerErrorKind,
} from '~/utils/tuner/environment'
import { TUNER_PARAMS } from '~/utils/tuner/params'
import { createTunerPipeline, type TunerPipeline } from '~/utils/tuner/pipeline'
import { referenceTonePlan } from '~/utils/tuner/referenceTone'
import {
  AUTO_MODE, TUNER_MODE_STORAGE_KEY, isValidStringIndex, parseStoredMode, serializeMode, type TunerMode,
} from '~/utils/tuner/strings'
import { createInitialTunerState, type TunerState } from '~/utils/tuner/tunerMachine'
import { selectTunerView, type TunerView } from '~/utils/tuner/tunerView'

/**
 * 調音器瀏覽器轉接層（ADR-005）：唯一擁有 AudioContext、MediaStream 與 rAF 的地方。
 * vue API 明確 import（ADR-006），可在 Vitest 直接掛載測試。只在 setup 中呼叫；
 * 所有瀏覽器存取都在 onMounted 或使用者事件內。
 */

export type TunerPhase =
  | { kind: 'checking' }
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'running' }
  | { kind: 'paused'; reason: 'hidden' | 'interrupted' | 'track-ended' }
  | { kind: 'error'; error: TunerErrorKind; inAppBrowser: InAppBrowser | null }
  | { kind: 'blocked'; reason: 'insecure' | 'unsupported'; audioOutputAvailable: boolean; inAppBrowser: InAppBrowser | null }

export interface UseTuner {
  phase: Readonly<Ref<TunerPhase>>
  view: Readonly<Ref<TunerView>>
  mode: Readonly<Ref<TunerMode>>
  /** 正在播放的 stringIndex */
  referencePlaying: Readonly<Ref<number | null>>
  /** onMounted 後才有值（SSR 時為空字串） */
  userAgent: Readonly<Ref<string>>
  /** 必須在 click handler 中「同步」呼叫（內部先同步建立/resume AudioContext 與呼叫 getUserMedia，再 await） */
  start(): Promise<void>
  stop(): void
  /** 點同一弦或 'auto' 回自動（TUN-12），寫入 localStorage（TUN-15） */
  selectString(stringIndex: number | 'auto'): void
  /** 同弦再按 = 停止；他弦 = 換播（TUN-91）；播放中暫停偵測（TUN-92） */
  toggleReference(stringIndex: number): void
}

/** 參考音結束後除了輸出延遲與淡出，再多等的時間 */
const TONE_TAIL_GUARD_MS = 150

function sameView(a: TunerView, b: TunerView): boolean {
  for (const key of Object.keys(a) as (keyof TunerView)[]) if (a[key] !== b[key]) return false
  return true
}

function loadMode(): TunerMode {
  try {
    return parseStoredMode(localStorage.getItem(TUNER_MODE_STORAGE_KEY)) ?? AUTO_MODE
  }
  catch {
    return AUTO_MODE // Safari 私密模式等
  }
}

function saveMode(mode: TunerMode) {
  try {
    localStorage.setItem(TUNER_MODE_STORAGE_KEY, serializeMode(mode))
  }
  catch { /* 不保存也能用 */ }
}

export function useTuner(): UseTuner {
  const phase = ref<TunerPhase>({ kind: 'checking' })
  const mode = ref<TunerMode>(AUTO_MODE)
  const referencePlaying = ref<number | null>(null)
  const userAgent = ref('')
  const view = shallowRef<TunerView>(selectTunerView(createInitialTunerState()))

  // 非反應式資源
  let audioCtx: AudioContext | null = null
  let mic: MicInput | null = null
  let pipeline: TunerPipeline | null = null
  let frameBuf: Float32Array<ArrayBuffer> | null = null
  let rafId: number | null = null
  let lastAnalysisAt = -Infinity
  let analysisResumeAt = -Infinity
  let tone: ToneHandle | null = null
  let startToken = 0
  let audioOutputAvailable = true
  let inAppBrowser: InAppBrowser | null = null

  /** 只在畫面需要的值有變化時才觸發 render */
  function commit(state: TunerState) {
    const next = selectTunerView(state)
    if (!sameView(next, view.value)) view.value = next
  }

  /** 參考音結束後，喇叭/藍牙輸出還有尾音：這段時間不分析，避免把參考音當成撥弦 */
  function holdAnalysisAfterTone(stringIndex: number) {
    const latencyS = audioCtx?.outputLatency ?? 0
    analysisResumeAt = performance.now() + (latencyS + referenceTonePlan(stringIndex).fadeOutS) * 1000 + TONE_TAIL_GUARD_MS
  }

  function stopReference() {
    const t = tone
    const playing = referencePlaying.value
    tone = null
    referencePlaying.value = null
    if (t && playing !== null) holdAnalysisAfterTone(playing)
    t?.stop()
  }

  function onTrackEnded() {
    if (phase.value.kind !== 'running') return
    teardown()
    phase.value = { kind: 'paused', reason: 'track-ended' }
  }

  function onCtxStateChange() {
    const state = audioCtx?.state as string | undefined
    // iOS 來電等會讓 context 變成 suspended / interrupted（TUN-62）
    if (phase.value.kind === 'running' && (state === 'suspended' || state === 'interrupted')) {
      teardown()
      phase.value = { kind: 'paused', reason: 'interrupted' }
    }
  }

  /** 冪等：停 rAF → 停參考音 → 斷開 + track.stop() → ctx.close()（ADR-005） */
  function teardown() {
    startToken++ // 讓進行中的 start() 在 resolve 後立刻釋放 stream
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    stopReference()
    if (mic) {
      for (const track of mic.stream.getTracks()) track.removeEventListener('ended', onTrackEnded)
      mic.release()
      mic = null
    }
    if (audioCtx) {
      audioCtx.onstatechange = null
      audioCtx.close().catch(() => {})
      audioCtx = null
    }
    if (pipeline) {
      commit(pipeline.dispatch({ type: 'suspend' }))
      pipeline = null
    }
    frameBuf = null
  }

  function loop(t: number) {
    rafId = requestAnimationFrame(loop)
    if (t - lastAnalysisAt < TUNER_PARAMS.minAnalysisIntervalMs) return
    lastAnalysisAt = t
    if (referencePlaying.value !== null || !pipeline || !mic || !frameBuf) return // TUN-92
    const now = performance.now()
    if (now < analysisResumeAt) return
    mic.analyser.getFloatTimeDomainData(frameBuf)
    commit(pipeline.process(frameBuf, now))
  }

  function fail(error: unknown) {
    const kind = classifyStartError(error)
    if (kind === 'unknown') console.warn('[tuner] start failed:', (error as { name?: unknown } | null)?.name ?? typeof error)
    phase.value = { kind: 'error', error: kind, inAppBrowser }
  }

  function ensureContext(): AudioContext | null {
    if (audioCtx) return audioCtx
    const Ctor = getAudioContextCtor()
    if (!Ctor) return null
    audioCtx = new Ctor()
    return audioCtx
  }

  async function finishStart(token: number, ctx: AudioContext, resumeP: Promise<void>, streamP: Promise<MediaStream>) {
    let stream: MediaStream
    try {
      stream = await streamP
    }
    catch (error) {
      if (token === startToken) fail(error)
      return
    }
    const abandon = () => stream.getTracks().forEach(t => t.stop())
    // 競態保護：權限對話框期間使用者離開 / 按停止 / 切背景
    if (token !== startToken) return abandon()

    await resumeP.catch(() => {})
    if (token !== startToken) return abandon()
    if (ctx.state !== 'running') await ctx.resume().catch(() => {})
    if (token !== startToken) return abandon()
    if (ctx.state !== 'running') {
      abandon()
      teardown()
      phase.value = { kind: 'paused', reason: 'interrupted' }
      return
    }

    try {
      pipeline = createTunerPipeline({ sampleRate: ctx.sampleRate, mode: mode.value })
      mic = connectMicrophone(ctx, stream, pipeline.windowSize)
      frameBuf = new Float32Array(pipeline.windowSize)
      commit(pipeline.state)
      for (const track of stream.getTracks()) track.addEventListener('ended', onTrackEnded)
      ctx.onstatechange = onCtxStateChange
      phase.value = { kind: 'running' }
      lastAnalysisAt = -Infinity
      rafId = requestAnimationFrame(loop)
    }
    catch (error) {
      // 例如 createMediaStreamSource 因取樣率不符拋出：stream 尚未交給 mic，必須在這裡停掉（TUN-60/63）
      abandon()
      teardown()
      fail(error)
      return
    }
    // resolve 時 track 已結束就不會再發 ended 事件
    if (stream.getTracks().some(t => t.readyState === 'ended')) onTrackEnded()
  }

  function start(): Promise<void> {
    const kind = phase.value.kind
    if (kind === 'checking' || kind === 'starting' || kind === 'running' || kind === 'blocked') return Promise.resolve()
    const token = ++startToken
    phase.value = { kind: 'starting' }
    let ctx: AudioContext | null
    let resumeP: Promise<void>
    let streamP: Promise<MediaStream>
    try {
      // 以下三步在 await 之前同步完成（iOS 手勢規則，TUN-51）
      ctx = ensureContext()
      if (!ctx) throw new TypeError('AudioContext unavailable')
      resumeP = ctx.resume()
      streamP = navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS)
    }
    catch (error) {
      fail(error)
      return Promise.resolve()
    }
    return finishStart(token, ctx, resumeP, streamP)
  }

  function stop() {
    teardown()
    if (phase.value.kind !== 'checking' && phase.value.kind !== 'blocked') phase.value = { kind: 'idle' }
  }

  function selectString(stringIndex: number | 'auto') {
    if (stringIndex !== 'auto' && !isValidStringIndex(stringIndex)) return
    const current = mode.value
    const next: TunerMode = stringIndex === 'auto' || (current.kind === 'manual' && current.stringIndex === stringIndex)
      ? AUTO_MODE
      : { kind: 'manual', stringIndex }
    mode.value = next
    saveMode(next)
    commit(pipeline
      ? pipeline.dispatch({ type: 'setMode', mode: next, now: performance.now() })
      : createInitialTunerState(next))
  }

  function toggleReference(stringIndex: number) {
    if (!isValidStringIndex(stringIndex)) return
    if (referencePlaying.value === stringIndex) return stopReference()
    stopReference()
    if (phase.value.kind === 'checking') return
    if (phase.value.kind === 'blocked' && !phase.value.audioOutputAvailable) return // TUN-57
    // 在點擊中同步建立 context（TUN-93：不需麥克風）
    const ctx = ensureContext()
    if (!ctx) return
    ctx.resume().catch(() => {})
    if (pipeline) commit(pipeline.dispatch({ type: 'suspend' }))
    const handle = playReferenceTone(ctx, referenceTonePlan(stringIndex))
    tone = handle
    referencePlaying.value = stringIndex
    handle.ended.then(() => {
      if (tone !== handle) return
      tone = null
      referencePlaying.value = null
      holdAnalysisAfterTone(stringIndex)
    })
  }

  function onVisibilityChange() {
    if (document.visibilityState !== 'hidden') return // 回到前景什麼都不做（TUN-62）
    const kind = phase.value.kind
    // 任何狀態都關閉 context（錯誤狀態下為參考音保留的也一樣）；下次點擊會在手勢內重建
    teardown()
    if (kind === 'running' || kind === 'starting') phase.value = { kind: 'paused', reason: 'hidden' }
  }

  function onPageHide() {
    const kind = phase.value.kind
    teardown()
    if (kind === 'running' || kind === 'starting') phase.value = { kind: 'paused', reason: 'hidden' }
  }

  onMounted(() => {
    userAgent.value = navigator.userAgent
    inAppBrowser = detectInAppBrowser(navigator.userAgent)
    mode.value = loadMode()
    commit(createInitialTunerState(mode.value))
    const env = checkEnvironment(readEnvironment())
    if (env.ok) {
      phase.value = { kind: 'idle' }
    }
    else {
      audioOutputAvailable = env.audioOutputAvailable
      phase.value = { kind: 'blocked', reason: env.reason, audioOutputAvailable, inAppBrowser }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', onPageHide)
  })

  onBeforeUnmount(() => {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange)
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', onPageHide)
    teardown()
  })

  return {
    phase: readonly(phase) as Readonly<Ref<TunerPhase>>,
    view: readonly(view) as Readonly<Ref<TunerView>>,
    mode: readonly(mode) as Readonly<Ref<TunerMode>>,
    referencePlaying: readonly(referencePlaying),
    userAgent: readonly(userAgent),
    start,
    stop,
    selectString,
    toggleReference,
  }
}
