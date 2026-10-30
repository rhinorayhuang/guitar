import { getAudioContextCtor } from '~/composables/audio/context'
import type { ReferenceTonePlan } from '~/utils/tuner/referenceTone'

/**
 * 瀏覽器音訊轉接層（模組 4，無 Vue）。所有全域存取都在函式內，SSR import 安全。
 * 音訊圖見 architecture.md §3.3。
 */

/** 已移到 audio/context.ts 共用（ADR-009）；保留舊路徑給調音器程式與測試 */
export { getAudioContextCtor }

/** TUN-27：以非 exact 的偏好值關閉處理，避免 OverconstrainedError */
export const MIC_CONSTRAINTS: MediaStreamConstraints = Object.freeze({
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  video: false,
})

export function readEnvironment(): { isSecureContext: boolean; hasGetUserMedia: boolean; hasAudioContext: boolean } {
  if (typeof window === 'undefined') return { isSecureContext: false, hasGetUserMedia: false, hasAudioContext: false }
  const isSecureContext = window.isSecureContext === true
  return {
    isSecureContext,
    // 非安全來源時不碰 navigator.mediaDevices（瀏覽器本來就不提供）
    hasGetUserMedia: isSecureContext && typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function',
    hasAudioContext: getAudioContextCtor() !== undefined,
  }
}

export interface MicInput {
  analyser: AnalyserNode
  stream: MediaStream
  /** disconnect + 所有 track.stop()；可重複呼叫 */
  release(): void
}

/**
 * 架構 §3.3：analyser 預設不接 destination（避免回授）。若 M0 實機發現 iOS Safari 因此不更新資料，
 * 把這個旗標改成 true：analyser → gain(0) → destination，只為了讓圖被拉動，聽不到聲音。
 */
export const PULL_ANALYSER_THROUGH_DESTINATION = false

export function connectMicrophone(
  ctx: AudioContext,
  stream: MediaStream,
  fftSize: number,
  pullThroughDestination: boolean = PULL_ANALYSER_THROUGH_DESTINATION,
): MicInput {
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = fftSize
  analyser.smoothingTimeConstant = 0
  source.connect(analyser)
  let sink: GainNode | null = null
  if (pullThroughDestination) {
    sink = ctx.createGain()
    sink.gain.value = 0
    analyser.connect(sink)
    sink.connect(ctx.destination)
  }
  let released = false
  return {
    analyser,
    stream,
    release() {
      if (released) return
      released = true
      try {
        source.disconnect()
        sink?.disconnect()
      }
      catch { /* 已斷開 */ }
      for (const track of stream.getTracks()) track.stop()
    },
  }
}

export interface ToneHandle {
  stop(): void
  readonly ended: Promise<void>
}

/** ADR-007：含泛音的 PeriodicWave，GainNode 線性淡入淡出 */
export function playReferenceTone(ctx: AudioContext, plan: ReferenceTonePlan): ToneHandle {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  const real = Float32Array.from(plan.harmonics)
  const imag = new Float32Array(real.length)
  osc.setPeriodicWave(ctx.createPeriodicWave(real, imag))
  osc.frequency.value = plan.frequency

  const t0 = ctx.currentTime
  const end = t0 + plan.durationS
  gain.gain.setValueAtTime(0, t0)
  gain.gain.linearRampToValueAtTime(plan.peakGain, t0 + plan.fadeInS)
  gain.gain.setValueAtTime(plan.peakGain, end - plan.fadeOutS)
  gain.gain.linearRampToValueAtTime(0, end)

  osc.connect(gain)
  gain.connect(ctx.destination)

  let resolveEnded!: () => void
  const ended = new Promise<void>((resolve) => {
    resolveEnded = resolve
  })
  let settled = false
  // context 被系統暫停（來電等）時 onended 不會觸發；以計時器保底，免得 UI 卡在「播放中」
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null
  const settle = () => {
    if (settled) return
    settled = true
    if (fallbackTimer !== null) clearTimeout(fallbackTimer)
    resolveEnded()
  }
  fallbackTimer = setTimeout(settle, (plan.durationS + 0.5) * 1000)
  osc.onended = () => {
    try {
      osc.disconnect()
      gain.disconnect()
    }
    catch { /* context 可能已關閉 */ }
    settle()
  }
  osc.start(t0)
  osc.stop(end)

  return {
    ended,
    stop() {
      if (settled) return
      // 提前停止也做短淡出，避免爆音；節點在 onended 時斷開
      try {
        const now = ctx.currentTime
        // 舊版 Safari 在排程中讀 gain.value 可能拿不到目前的自動化值，淡出起點會跳變
        if (typeof gain.gain.cancelAndHoldAtTime === 'function') {
          gain.gain.cancelAndHoldAtTime(now)
        }
        else {
          gain.gain.cancelScheduledValues(now)
          gain.gain.setValueAtTime(gain.gain.value, now)
        }
        gain.gain.linearRampToValueAtTime(0, now + plan.fadeOutS)
        osc.stop(now + plan.fadeOutS)
      }
      catch { /* context 已關閉 */ }
      // UI 立即視為已停止（context 被關閉時 onended 可能不會觸發）
      settle()
    },
  }
}
