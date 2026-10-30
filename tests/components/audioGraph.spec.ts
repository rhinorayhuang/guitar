// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { connectMicrophone, playReferenceTone } from '~/composables/tuner/audioGraph'
import { referenceTonePlan } from '~/utils/tuner/referenceTone'
import { FakeAudioContext, FakeMediaStream } from '../helpers/fakeAudio'

const asCtx = (c: FakeAudioContext) => c as unknown as AudioContext
const asStream = (s: FakeMediaStream) => s as unknown as MediaStream

describe('connectMicrophone (architecture §3.3)', () => {
  it('does not connect to destination by default', () => {
    const ctx = new FakeAudioContext()
    connectMicrophone(asCtx(ctx), asStream(new FakeMediaStream()), 2048)
    expect(ctx.createGain).not.toHaveBeenCalled()
    expect(ctx.analysers[0]!.connect).not.toHaveBeenCalled()
  })

  it('pull-through mode routes analyser → silent gain → destination and disconnects it on release', () => {
    const ctx = new FakeAudioContext()
    const stream = new FakeMediaStream()
    const mic = connectMicrophone(asCtx(ctx), asStream(stream), 2048, true)
    const sink = ctx.createGain.mock.results[0]!.value
    expect(sink.gain.value).toBe(0)
    expect(ctx.analysers[0]!.connect).toHaveBeenCalledWith(sink)
    expect(sink.connect).toHaveBeenCalledWith(ctx.destination)
    mic.release()
    expect(sink.disconnect).toHaveBeenCalled()
    expect(stream.tracks[0]!.stop).toHaveBeenCalled()
  })
})

describe('playReferenceTone stop()', () => {
  it('prefers cancelAndHoldAtTime for the fade-out when available', () => {
    const ctx = new FakeAudioContext()
    const handle = playReferenceTone(asCtx(ctx), referenceTonePlan(1))
    const gain = ctx.createGain.mock.results[0]!.value.gain
    gain.cancelAndHoldAtTime = vi.fn()
    handle.stop()
    expect(gain.cancelAndHoldAtTime).toHaveBeenCalled()
    expect(gain.cancelScheduledValues).not.toHaveBeenCalled()
  })

  it('falls back to cancelScheduledValues + setValueAtTime without it', () => {
    const ctx = new FakeAudioContext()
    const handle = playReferenceTone(asCtx(ctx), referenceTonePlan(1))
    const gain = ctx.createGain.mock.results[0]!.value.gain
    handle.stop()
    expect(gain.cancelScheduledValues).toHaveBeenCalled()
  })

  it('settles via the fallback timer when onended never fires', async () => {
    vi.useFakeTimers()
    try {
      const ctx = new FakeAudioContext()
      const plan = referenceTonePlan(1)
      let ended = false
      playReferenceTone(asCtx(ctx), plan).ended.then(() => {
        ended = true
      })
      await vi.advanceTimersByTimeAsync((plan.durationS + 0.4) * 1000)
      expect(ended).toBe(false)
      await vi.advanceTimersByTimeAsync(200)
      expect(ended).toBe(true)
    }
    finally {
      vi.useRealTimers()
    }
  })
})
