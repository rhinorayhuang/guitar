import { computed, onBeforeUnmount, onMounted, readonly, ref, type ComputedRef, type Ref } from 'vue'
import { getAudioContextCtor, readOutputClock } from '~/composables/audio/context'
import { createScheduler, type Scheduler } from '~/composables/audio/scheduler'
import { createVoicePool, type VoicePool } from '~/composables/audio/voicePool'
import { scheduleClick } from '~/composables/metronome/clickVoice'
import { createScreenWakeLock } from '~/composables/screen/wakeLock'
import { estimateAudibleTime } from '~/utils/clock/audibleTime'
import { createStepQueue, type StepQueue } from '~/utils/clock/stepQueue'
import { clampBpm } from '~/utils/clock/tempo'
import { beatOf } from '~/utils/metronome/beats'
import { clickPlan } from '~/utils/metronome/clickPlan'
import { BEATS_PER_BAR, DEFAULT_BPM } from '~/utils/metronome/params'

/**
 * 節拍器瀏覽器轉接層（metronome-architecture.md §7.2、ADR-009）：AudioContext、rAF、Screen Wake Lock
 * 的唯一擁有者。vue API 明確 import（ADR-006），可在 Vitest 直接掛載測試。
 * 只在 setup 中呼叫；setup 只建立 ref，所有瀏覽器存取都在 onMounted 或使用者事件內。
 */

export type MetronomePhase =
  | { kind: 'checking' } // SSR 與 onMounted 之前
  | { kind: 'idle' }
  | { kind: 'starting' } // 已在手勢內建立 context，等 resume
  | { kind: 'running' }
  | { kind: 'paused'; reason: 'hidden' | 'interrupted' } // 切背景、來電、resume 失敗
  | { kind: 'unsupported' } // 沒有 AudioContext

export interface UseMetronome {
  phase: Readonly<Ref<MetronomePhase>>
  /** phase 不是 checking / unsupported */
  available: Readonly<ComputedRef<boolean>>
  /** starting | running */
  isPlaying: Readonly<ComputedRef<boolean>>
  bpm: Readonly<Ref<number>>
  /** 0..beatsPerBar-1；未播放或第一拍尚未被聽到時 null */
  currentBeat: Readonly<Ref<number | null>>
  readonly beatsPerBar: typeof BEATS_PER_BAR
  /** 必須在 click handler 中「同步」呼叫；內部先同步 new AudioContext() + resume()，之後才 await */
  start(): Promise<void>
  stop(): void
  toggle(): Promise<void> | void
  /** clampBpm；播放中依 §3.5 下一拍生效 */
  setBpm(bpm: number): void
  /** ±1 / ±5 */
  nudgeBpm(delta: number): void
  /** 「用 N BPM 練習」：setBpm(n)；未播放則 start()；播放中只換速度，不重建 context。必須在 click 中呼叫 */
  playAt(bpm: number): Promise<void> | void
}

export function useMetronome(opts: { initialBpm?: number } = {}): UseMetronome {
  const phase = ref<MetronomePhase>({ kind: 'checking' })
  const bpm = ref(clampBpm(opts.initialBpm ?? DEFAULT_BPM, DEFAULT_BPM))
  const currentBeat = ref<number | null>(null)
  const available = computed(() => phase.value.kind !== 'checking' && phase.value.kind !== 'unsupported')
  const isPlaying = computed(() => phase.value.kind === 'starting' || phase.value.kind === 'running')

  // 非反應式資源
  let audioCtx: AudioContext | null = null
  let master: GainNode | null = null
  let pool: VoicePool | null = null
  let queue: StepQueue | null = null
  let scheduler: Scheduler | null = null
  let rafId: number | null = null
  let startToken = 0
  const wakeLock = createScreenWakeLock()

  function onStep(step: number, time: number) {
    if (!audioCtx || !master || !pool || !queue) return
    const { beatInBar, accent } = beatOf(step, BEATS_PER_BAR)
    const { source, nodes } = scheduleClick(audioCtx, master, clickPlan(accent), time)
    pool.add(source, nodes)
    queue.push({ step, time, beatInBar })
  }

  function frame(perfNow: number) {
    rafId = requestAnimationFrame(frame)
    if (!audioCtx || !scheduler || !queue) return
    scheduler.tick() // 第二個喚醒來源；tick 冪等
    const e = queue.advance(estimateAudibleTime(readOutputClock(audioCtx, perfNow)))
    // 只在值改變時寫入：每秒最多數次反應式更新
    if (e && e.beatInBar !== currentBeat.value) currentBeat.value = e.beatInBar
  }

  /** 冪等（§4.4）：清計時器 → 停 rAF → 靜音並斷開 → 清佇列 → 關 context → 釋放 Wake Lock */
  function teardown() {
    startToken++ // 讓進行中的 start() 在 resume 之後什麼都不做
    scheduler?.stop()
    scheduler = null
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    const ctx = audioCtx
    if (pool) pool.silenceAll(ctx?.currentTime ?? 0)
    pool = null
    if (master) {
      try {
        if (ctx) master.gain.setValueAtTime(0, ctx.currentTime)
        master.disconnect()
      }
      catch { /* context 已關閉 */ }
      master = null
    }
    queue?.clear()
    queue = null
    currentBeat.value = null
    if (ctx) {
      ctx.onstatechange = null
      ctx.close().catch(() => {})
      audioCtx = null
    }
    wakeLock.release()
  }

  function pause(reason: 'hidden' | 'interrupted') {
    teardown()
    phase.value = { kind: 'paused', reason }
  }

  function onCtxStateChange() {
    // iOS 來電、Siri 等會讓 context 變成 suspended / interrupted
    if (phase.value.kind === 'running' && audioCtx && audioCtx.state !== 'running') pause('interrupted')
  }

  async function finishStart(token: number, ctx: AudioContext, resumeP: Promise<void>) {
    await resumeP.catch(() => {})
    if (token !== startToken) return // 期間已 stop / 切背景 / 離開
    if (ctx.state !== 'running') return pause('interrupted')
    try {
      master = ctx.createGain()
      master.connect(ctx.destination)
      pool = createVoicePool()
      queue = createStepQueue()
      scheduler = createScheduler({ ctx, bpm: bpm.value, onStep })
      ctx.onstatechange = onCtxStateChange
      phase.value = { kind: 'running' }
      scheduler.start()
      rafId = requestAnimationFrame(frame)
      wakeLock.acquire()
    }
    catch (error) {
      console.warn('[metronome] start failed:', (error as { name?: unknown } | null)?.name ?? typeof error)
      pause('interrupted')
    }
  }

  function start(): Promise<void> {
    const kind = phase.value.kind
    if (kind === 'checking' || kind === 'unsupported' || kind === 'starting' || kind === 'running') return Promise.resolve()
    const Ctor = getAudioContextCtor()
    if (!Ctor) {
      phase.value = { kind: 'unsupported' }
      return Promise.resolve()
    }
    const token = ++startToken
    let ctx: AudioContext
    let resumeP: Promise<void>
    try {
      // 以下兩步在 await 之前同步完成（iOS 手勢規則）
      ctx = audioCtx = new Ctor()
      resumeP = ctx.resume()
    }
    catch {
      pause('interrupted')
      return Promise.resolve()
    }
    phase.value = { kind: 'starting' }
    return finishStart(token, ctx, resumeP)
  }

  function stop() {
    teardown()
    const kind = phase.value.kind
    if (kind !== 'checking' && kind !== 'unsupported') phase.value = { kind: 'idle' }
  }

  function toggle(): Promise<void> | void {
    return isPlaying.value ? stop() : start()
  }

  function setBpm(next: number) {
    const value = clampBpm(next, bpm.value)
    if (value === bpm.value) return
    bpm.value = value
    scheduler?.setBpm(value)
  }

  function nudgeBpm(delta: number) {
    setBpm(bpm.value + delta)
  }

  function playAt(next: number): Promise<void> | void {
    setBpm(next)
    if (!isPlaying.value) return start()
  }

  function onVisibilityChange() {
    if (document.visibilityState !== 'hidden') return // 回到前景不自動重啟
    const kind = phase.value.kind
    teardown()
    if (kind === 'running' || kind === 'starting') phase.value = { kind: 'paused', reason: 'hidden' }
  }

  function onPageHide() {
    const kind = phase.value.kind
    teardown()
    if (kind === 'running' || kind === 'starting') phase.value = { kind: 'paused', reason: 'hidden' }
  }

  onMounted(() => {
    phase.value = getAudioContextCtor() ? { kind: 'idle' } : { kind: 'unsupported' }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', onPageHide)
  })

  onBeforeUnmount(() => {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange)
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', onPageHide)
    teardown()
  })

  return {
    phase: readonly(phase) as Readonly<Ref<MetronomePhase>>,
    available,
    isPlaying,
    bpm: readonly(bpm),
    currentBeat: readonly(currentBeat),
    beatsPerBar: BEATS_PER_BAR,
    start,
    stop,
    toggle,
    setBpm,
    nudgeBpm,
    playAt,
  }
}
