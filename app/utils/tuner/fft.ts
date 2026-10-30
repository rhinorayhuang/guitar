/** 預先配置的 radix-2 複數 FFT；size 必須是 2 的冪。forward/inverse 皆原地運算、不配置記憶體 */
export interface Fft {
  readonly size: number
  forward(re: Float64Array, im: Float64Array): void
  /** 含 1/N 正規化 */
  inverse(re: Float64Array, im: Float64Array): void
}

export function createFft(size: number): Fft {
  if (size < 2 || (size & (size - 1)) !== 0) throw new Error(`FFT size must be a power of 2, got ${size}`)

  const levels = Math.log2(size)
  const rev = new Uint32Array(size)
  for (let i = 0; i < size; i++) {
    let r = 0
    for (let b = 0; b < levels; b++) r |= ((i >>> b) & 1) << (levels - 1 - b)
    rev[i] = r
  }
  const half = size / 2
  const cos = new Float64Array(half)
  const sin = new Float64Array(half)
  for (let i = 0; i < half; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / size)
    sin[i] = Math.sin((2 * Math.PI * i) / size)
  }

  function transform(re: Float64Array, im: Float64Array, sign: 1 | -1) {
    for (let i = 0; i < size; i++) {
      const j = rev[i]!
      if (j > i) {
        let t = re[i]!; re[i] = re[j]!; re[j] = t
        t = im[i]!; im[i] = im[j]!; im[j] = t
      }
    }
    for (let len = 2; len <= size; len <<= 1) {
      const halfLen = len >>> 1
      const step = size / len
      for (let start = 0; start < size; start += len) {
        for (let k = 0; k < halfLen; k++) {
          const wr = cos[k * step]!
          const wi = sign * sin[k * step]!
          const a = start + k
          const b = a + halfLen
          const xr = re[b]! * wr - im[b]! * wi
          const xi = re[b]! * wi + im[b]! * wr
          re[b] = re[a]! - xr
          im[b] = im[a]! - xi
          re[a] = re[a]! + xr
          im[a] = im[a]! + xi
        }
      }
    }
  }

  return {
    size,
    forward: (re, im) => transform(re, im, -1),
    inverse(re, im) {
      transform(re, im, 1)
      for (let i = 0; i < size; i++) {
        re[i] = re[i]! / size
        im[i] = im[i]! / size
      }
    },
  }
}
