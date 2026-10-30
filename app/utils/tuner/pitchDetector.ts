import { createFft } from './fft'
import { TUNER_PARAMS, resolveParams, windowSizeFor, type TunerParams } from './params'

/**
 * McLeod Pitch Method（ADR-001）：NSDF 以 FFT 計算 + 拋物線內插 + 子八度檢查。
 * 規格見 architecture.md §2.4。
 */

export interface PitchEstimate {
  freq: number
  /** 內插後 NSDF 峰值，夾在 [0, 1] */
  clarity: number
}

export interface PitchDetectorOptions {
  sampleRate: number
  windowSize: number
  minFreq: number
  maxFreq: number
  k: number
  octaveGuardMargin: number
  /** 前置 2 階 Butterworth 低通截止頻率（Hz）；0 / 省略 = 不濾波 */
  lowpassHz?: number
}

export interface PitchDetector {
  readonly options: Readonly<PitchDetectorOptions>
  /** frame.length 必須 === windowSize；不配置記憶體；超出範圍或無峰回傳 null */
  detect(frame: Float32Array): PitchEstimate | null
  /** 測試用：計算 NSDF 並回傳內部緩衝（有效範圍 τ = 0..searchEnd + 1；下次呼叫會覆寫） */
  computeNsdf(frame: Float32Array): Float64Array
  readonly searchEnd: number
}

function biquadLowpass(cutoffHz: number, sampleRate: number) {
  const w0 = (2 * Math.PI * cutoffHz) / sampleRate
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2)
  const cos = Math.cos(w0)
  const a0 = 1 + alpha
  return {
    b0: (1 - cos) / 2 / a0,
    b1: (1 - cos) / a0,
    b2: (1 - cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  }
}

/** 子八度檢查時，候選峰位置允許的相對誤差 */
const OCTAVE_GUARD_TOLERANCE = 0.03
const OCTAVE_GUARD_MULTIPLES = [2, 3] as const

export function createPitchDetector(options: PitchDetectorOptions): PitchDetector {
  const opts = Object.freeze({ ...options })
  const { sampleRate, windowSize: W, minFreq, maxFreq, k, octaveGuardMargin } = opts
  if ((W & (W - 1)) !== 0) throw new Error(`windowSize must be a power of 2, got ${W}`)

  const tauMax = Math.ceil(sampleRate / minFreq)
  const searchEnd = Math.min(W - 2, Math.ceil(1.1 * tauMax))

  // 一次配置，detect() 內零配置（避免 GC 停頓）
  const N = 2 * W
  const fft = createFft(N)
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  const x = new Float64Array(W)
  const nsdf = new Float64Array(W)
  const peaks = new Int32Array(W)

  // 前置低通（RBJ biquad，Q = 1/√2）：LTI 濾波不改變週期，但濾掉吉他有用泛音以上的寬頻雜訊，
  // 讓 NSDF 峰位置在雜訊下更穩（TUN-38；SNR 20 dB 時每幀抖動約 3 → 0.8 cents）。
  // 每幀從零狀態開始，邊緣暫態會造成小偏差：截止 1.5 kHz 時合成訊號誤差達 2 cents，5 kHz 時 < 0.5 cent，故預設 5 kHz。
  const lowpass = opts.lowpassHz && opts.lowpassHz > 0 && opts.lowpassHz < sampleRate / 2
    ? biquadLowpass(opts.lowpassHz, sampleRate)
    : null

  function parabolic(tau: number): { tau: number; value: number } {
    const a = nsdf[tau - 1]!
    const b = nsdf[tau]!
    const c = nsdf[tau + 1]!
    const denom = a - 2 * b + c
    if (denom === 0) return { tau, value: b }
    const delta = (0.5 * (a - c)) / denom
    return { tau: tau + delta, value: b - 0.25 * (a - c) * delta }
  }

  /** 去直流 + NSDF；回傳能量（0 表示訊號全平） */
  function fillNsdf(frame: Float32Array): number {
    if (frame.length !== W) throw new Error(`frame length ${frame.length} !== windowSize ${W}`)

    // 1. 去直流
    let mean = 0
    for (let i = 0; i < W; i++) mean += frame[i]!
    mean /= W
    let energy = 0
    if (lowpass) {
      // 前向 + 反向（零相位）：兩端暫態對稱，不會讓 NSDF 峰位置產生偏移
      const { b0, b1, b2, a1, a2 } = lowpass
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0
      for (let i = 0; i < W; i++) {
        const v = frame[i]! - mean
        const y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2 = x1; x1 = v; y2 = y1; y1 = y
        x[i] = y
      }
      x1 = 0; x2 = 0; y1 = 0; y2 = 0
      for (let i = W - 1; i >= 0; i--) {
        const v = x[i]!
        const y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2 = x1; x1 = v; y2 = y1; y1 = y
        x[i] = y
        energy += y * y
      }
    }
    else {
      for (let i = 0; i < W; i++) {
        const v = frame[i]! - mean
        x[i] = v
        energy += v * v
      }
    }
    if (energy === 0) {
      nsdf.fill(0)
      return 0
    }

    // 2. 自相關 r(τ)：補零至 2W 後 FFT → |X|² → IFFT
    for (let i = 0; i < N; i++) {
      re[i] = i < W ? x[i]! : 0
      im[i] = 0
    }
    fft.forward(re, im)
    for (let i = 0; i < N; i++) {
      re[i] = re[i]! * re[i]! + im[i]! * im[i]!
      im[i] = 0
    }
    fft.inverse(re, im)

    // m(τ) 遞迴；n(τ) = 2r(τ) / m(τ)
    let m = 2 * energy
    const eps = m * 1e-12
    nsdf[0] = 1
    for (let tau = 1; tau <= searchEnd + 1; tau++) {
      m -= x[tau - 1]! * x[tau - 1]! + x[W - tau]! * x[W - tau]!
      nsdf[tau] = m > eps ? (2 * re[tau]!) / m : 0
    }
    return energy
  }

  function detect(frame: Float32Array): PitchEstimate | null {
    if (fillNsdf(frame) === 0) return null

    // 3. key maxima：跳過 τ = 0 的正瓣，之後每個正區段取最大值
    let peakCount = 0
    let tau = 1
    while (tau <= searchEnd && nsdf[tau]! > 0) tau++
    let inPositive = false
    let best = -1
    for (; tau <= searchEnd; tau++) {
      const v = nsdf[tau]!
      if (v > 0) {
        if (!inPositive) {
          inPositive = true
          best = tau
        }
        else if (v > nsdf[best]!) {
          best = tau
        }
      }
      else if (inPositive) {
        inPositive = false
        if (best >= 2) peaks[peakCount++] = best
      }
    }
    // 最後一段在搜尋終點前未轉負：只有峰值確實在區段內部（不是卡在邊界）時才保留。
    // 架構文件原規則是一律丟棄，但純正弦 70–75 Hz 的零交越會落在 1.1·τmax 之外，見回報。
    if (inPositive && best >= 2 && best < searchEnd && nsdf[best + 1]! < nsdf[best]!) peaks[peakCount++] = best
    if (peakCount === 0) return null

    // 4. 選峰：第一個 ≥ k·nMax 的 key maximum
    let nMax = 0
    for (let i = 0; i < peakCount; i++) nMax = Math.max(nMax, nsdf[peaks[i]!]!)
    if (nMax <= 0) return null
    let chosen = -1
    for (let i = 0; i < peakCount; i++) {
      if (nsdf[peaks[i]!]! >= k * nMax) {
        chosen = peaks[i]!
        break
      }
    }
    if (chosen < 0) return null

    // 6. 拋物線內插
    let est = parabolic(chosen)

    // 7. 子八度檢查：m·τ* 附近有明顯更高的峰時改選該峰
    let guardTau = -1
    let guardValue = -Infinity
    for (const mult of OCTAVE_GUARD_MULTIPLES) {
      const target = mult * est.tau
      for (let i = 0; i < peakCount; i++) {
        const p = peaks[i]!
        if (p > tauMax || Math.abs(p - target) > OCTAVE_GUARD_TOLERANCE * target) continue
        const v = nsdf[p]!
        if (v - est.value >= octaveGuardMargin && v > guardValue) {
          guardTau = p
          guardValue = v
        }
      }
    }
    if (guardTau > 0) est = parabolic(guardTau)

    // 5. 範圍判斷：選中的峰在範圍外就回傳 null，不往後找其他峰（避免八度錯誤，TUN-22）
    const freq = sampleRate / est.tau
    if (!(freq >= minFreq && freq <= maxFreq)) return null

    return { freq, clarity: Math.min(1, Math.max(0, est.value)) }
  }

  return {
    options: opts,
    searchEnd,
    detect,
    computeNsdf(frame) {
      fillNsdf(frame)
      return nsdf
    },
  }
}

export function detectorOptionsFor(sampleRate: number, params: TunerParams = TUNER_PARAMS): PitchDetectorOptions {
  return {
    sampleRate,
    windowSize: windowSizeFor(sampleRate, params.minFreq),
    minFreq: params.minFreq,
    maxFreq: params.maxFreq,
    k: params.mpmK,
    octaveGuardMargin: params.octaveGuardMargin,
    lowpassHz: params.lowpassHz,
  }
}

/** PRD §7 建議的便利函式；每次呼叫都新建 detector，只用於測試/離線。frame 長度需等於 windowSizeFor(sampleRate) */
export function detectPitch(frame: Float32Array, sampleRate: number, params?: Partial<TunerParams>): PitchEstimate | null {
  return createPitchDetector(detectorOptionsFor(sampleRate, resolveParams(params))).detect(frame)
}

/** 去直流後的 RMS */
export function computeRms(frame: Float32Array): number {
  const n = frame.length
  if (n === 0) return 0
  let mean = 0
  for (let i = 0; i < n; i++) mean += frame[i]!
  mean /= n
  let sum = 0
  for (let i = 0; i < n; i++) {
    const v = frame[i]! - mean
    sum += v * v
  }
  return Math.sqrt(sum / n)
}

/** 20·log10(rms)；0 → -Infinity */
export function toDbfs(rms: number): number {
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity
}
