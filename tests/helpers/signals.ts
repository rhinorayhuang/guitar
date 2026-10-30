import { gaussian, mulberry32 } from './prng'

/** 合成測試訊號（architecture.md §8.1） */

export function sine(freq: number, sr: number, durS: number, amp = 0.5, phase = 0): Float32Array {
  const n = Math.round(sr * durS)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr + phase)
  return out
}

/** 撥弦標準訊號：基頻 0.3 < 第 2 泛音 1.0 */
export const PLUCK_HARMONICS = [0.3, 1.0, 0.7, 0.5, 0.35, 0.25] as const

/** 泛音加總 + 隨機相位（固定種子）+ 指數衰減 + 線性 attack；整體正規化到峰值 amp */
export function pluck(
  freq: number,
  sr: number,
  durS: number,
  opts: { harmonics?: readonly number[]; decayS?: number; seed?: number; amp?: number; attackS?: number } = {},
): Float32Array {
  const harmonics = opts.harmonics ?? PLUCK_HARMONICS
  const decayS = opts.decayS ?? 1.5
  const attackS = opts.attackS ?? 0.005
  const rand = mulberry32(opts.seed ?? 1)
  const phases = harmonics.map(() => rand() * 2 * Math.PI)
  const n = Math.round(sr * durS)
  const out = new Float32Array(n)
  let peak = 0
  for (let i = 0; i < n; i++) {
    const t = i / sr
    let v = 0
    for (let h = 0; h < harmonics.length; h++) v += harmonics[h]! * Math.sin(2 * Math.PI * freq * (h + 1) * t + phases[h]!)
    const env = Math.exp(-t / decayS) * Math.min(1, t / attackS)
    out[i] = v * env
    peak = Math.max(peak, Math.abs(out[i]!))
  }
  const scale = (opts.amp ?? 0.5) / peak
  for (let i = 0; i < n; i++) out[i] = out[i]! * scale
  return out
}

/** 相位連續的頻率階躍 */
export function steppedSine(segments: { freq: number; durS: number }[], sr: number, amp = 0.5): Float32Array {
  const total = segments.reduce((s, seg) => s + Math.round(seg.durS * sr), 0)
  const out = new Float32Array(total)
  let phase = 0
  let i = 0
  for (const seg of segments) {
    const n = Math.round(seg.durS * sr)
    for (let k = 0; k < n; k++, i++) {
      out[i] = amp * Math.sin(phase)
      phase += (2 * Math.PI * seg.freq) / sr
    }
  }
  return out
}

export function rms(sig: Float32Array): number {
  let s = 0
  for (const v of sig) s += v * v
  return Math.sqrt(s / sig.length)
}

/** 相對訊號 RMS 的白雜訊 */
export function withNoise(sig: Float32Array, snrDb: number, seed = 7): Float32Array {
  const g = gaussian(mulberry32(seed))
  const noiseRms = rms(sig) / 10 ** (snrDb / 20)
  return sig.map(v => v + g() * noiseRms)
}

export function whiteNoise(sr: number, durS: number, dbfs: number, seed = 3): Float32Array {
  const g = gaussian(mulberry32(seed))
  const level = 10 ** (dbfs / 20)
  return new Float32Array(Math.round(sr * durS)).map(() => g() * level)
}

/** 以峰值比例硬削波 */
export function clip(sig: Float32Array, level: number): Float32Array {
  let peak = 0
  for (const v of sig) peak = Math.max(peak, Math.abs(v))
  const limit = peak * level
  return sig.map(v => Math.max(-limit, Math.min(limit, v)))
}

export function silence(sr: number, durS: number): Float32Array {
  return new Float32Array(Math.round(sr * durS))
}

export function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

export const centsOff = (freq: number, cents: number) => freq * 2 ** (cents / 1200)
export const centsError = (est: number, truth: number) => 1200 * Math.log2(est / truth)
