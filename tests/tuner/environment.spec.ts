import { describe, expect, it } from 'vitest'
import { checkEnvironment, classifyStartError, detectInAppBrowser } from '~/utils/tuner/environment'
import { TUNER_PARAMS } from '~/utils/tuner/params'
import { referenceTonePlan } from '~/utils/tuner/referenceTone'
import { TUNER_STRINGS } from '~/utils/tuner/strings'

describe('TUN-56/57: checkEnvironment', () => {
  it('ok when secure and supported', () => {
    expect(checkEnvironment({ isSecureContext: true, hasGetUserMedia: true, hasAudioContext: true })).toEqual({ ok: true })
  })

  it('insecure takes priority over unsupported', () => {
    expect(checkEnvironment({ isSecureContext: false, hasGetUserMedia: false, hasAudioContext: true }))
      .toEqual({ ok: false, reason: 'insecure', audioOutputAvailable: true })
  })

  it('unsupported without getUserMedia keeps audio output', () => {
    expect(checkEnvironment({ isSecureContext: true, hasGetUserMedia: false, hasAudioContext: true }))
      .toEqual({ ok: false, reason: 'unsupported', audioOutputAvailable: true })
  })

  it('no AudioContext → unsupported with no audio output', () => {
    expect(checkEnvironment({ isSecureContext: true, hasGetUserMedia: true, hasAudioContext: false }))
      .toEqual({ ok: false, reason: 'unsupported', audioOutputAvailable: false })
  })
})

describe('TUN-53–55/59: classifyStartError', () => {
  it.each([
    ['NotAllowedError', 'permission-denied'],
    ['SecurityError', 'permission-denied'],
    ['NotFoundError', 'not-found'],
    ['OverconstrainedError', 'not-found'],
    ['NotReadableError', 'not-readable'],
    ['AbortError', 'not-readable'],
    ['TypeError', 'unknown'],
    ['SomethingElse', 'unknown'],
  ])('%s → %s', (name, kind) => {
    const err = new Error('x')
    err.name = name
    expect(classifyStartError(err)).toBe(kind)
    expect(classifyStartError({ name })).toBe(kind)
  })

  it.each([null, undefined, 'NotAllowedError', 42, {}])('non-error %j → unknown', (v) => {
    expect(classifyStartError(v)).toBe('unknown')
  })
})

describe('TUN-58: detectInAppBrowser', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/13.17.0', 'line'],
    ['Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/118.0 Mobile Safari/537.36 Line/13.18.1/IAB', 'line'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 305.0.0.0', 'instagram'],
    ['Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0 Mobile Safari/537.36 Instagram 305.0.0.0 Android', 'instagram'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/440.0]', 'facebook'],
    ['Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/440.0]', 'facebook'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', null],
    ['Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36', null],
  ])('%s', (ua, expected) => {
    expect(detectInAppBrowser(ua)).toBe(expected)
  })
})

describe('TUN-90: reference tone plan', () => {
  it.each(TUNER_STRINGS.map(s => [s.label, s.index] as const))('%s', (_, i) => {
    const plan = referenceTonePlan(i)
    expect(plan.frequency).toBe(TUNER_STRINGS[i]!.frequency)
    expect(Math.abs(1200 * Math.log2(plan.frequency / TUNER_STRINGS[i]!.frequency))).toBeLessThanOrEqual(0.5)
    expect(plan.fadeInS).toBeGreaterThanOrEqual(0.02)
    expect(plan.fadeOutS).toBeGreaterThanOrEqual(0.02)
    expect(plan.durationS).toBeCloseTo(2, 5)
    expect(plan.harmonics[0]).toBe(0)
    expect(plan.harmonics[1]).toBe(1)
  })

  it('rejects invalid indices', () => {
    expect(() => referenceTonePlan(6)).toThrow(RangeError)
  })

  it('params match the architecture defaults for §10', () => {
    expect(TUNER_PARAMS).toMatchObject({
      autoSwitchCount: 3, autoSwitchMinMs: 100, gateOpenDbfs: -50, gateCloseDbfs: -53, minClarity: 0.9, holdMs: 1500,
    })
  })
})
