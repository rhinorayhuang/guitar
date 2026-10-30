/** 直接 O(W·τ) 的 NSDF 參考實作，驗證 FFT 版結果一致 */
export function nsdfReference(frame: Float32Array, maxTau: number): Float64Array {
  const W = frame.length
  let mean = 0
  for (const v of frame) mean += v
  mean /= W
  const x = Float64Array.from(frame, v => v - mean)
  const out = new Float64Array(maxTau + 1)
  for (let tau = 0; tau <= maxTau; tau++) {
    let r = 0
    let m = 0
    for (let j = 0; j < W - tau; j++) {
      r += x[j]! * x[j + tau]!
      m += x[j]! * x[j]! + x[j + tau]! * x[j + tau]!
    }
    out[tau] = m > 0 ? (2 * r) / m : 0
  }
  return out
}
