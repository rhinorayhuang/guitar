// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { getAudioContextCtor as fromAudio, readOutputClock } from '~/composables/audio/context'
import { createVoicePool } from '~/composables/audio/voicePool'
import { scheduleClick } from '~/composables/metronome/clickVoice'
import { getAudioContextCtor as fromTuner } from '~/composables/tuner/audioGraph'
import { clickPlan } from '~/utils/metronome/clickPlan'
import { FakeAudioContext, FakeGain } from '../helpers/fakeAudio'

const asCtx = (c: FakeAudioContext) => c as unknown as AudioContext

function voice(ctx: FakeAudioContext) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  return { osc, gain, source: osc as unknown as AudioScheduledSourceNode, nodes: [osc, gain] as unknown as AudioNode[] }
}

describe('voicePool (§4.3)', () => {
  it('add → size + 1; end() disconnects every node and removes it', () => {
    const ctx = new FakeAudioContext()
    const pool = createVoicePool()
    const v = voice(ctx)
    pool.add(v.source, v.nodes)
    expect(pool.size).toBe(1)
    v.osc.end()
    expect(v.osc.disconnect).toHaveBeenCalled()
    expect(v.gain.disconnect).toHaveBeenCalled()
    expect(pool.size).toBe(0)
  })

  it('silenceAll(t) stops every source at t, disconnects everything and empties the pool', () => {
    const ctx = new FakeAudioContext()
    const pool = createVoicePool()
    const vs = [voice(ctx), voice(ctx), voice(ctx)]
    for (const v of vs) pool.add(v.source, v.nodes)
    pool.silenceAll(4.2)
    expect(pool.size).toBe(0)
    for (const v of vs) {
      expect(v.osc.stop).toHaveBeenCalledWith(4.2)
      expect(v.osc.disconnect).toHaveBeenCalled()
      expect(v.gain.disconnect).toHaveBeenCalled()
      expect(() => v.osc.end()).not.toThrow()
    }
  })

  it('silenceAll tolerates nodes that throw (closed context)', () => {
    const ctx = new FakeAudioContext()
    const pool = createVoicePool()
    const v = voice(ctx)
    v.osc.stop.mockImplementation(() => {
      throw new Error('InvalidStateError')
    })
    v.gain.disconnect.mockImplementation(() => {
      throw new Error('InvalidAccessError')
    })
    pool.add(v.source, v.nodes)
    expect(() => pool.silenceAll(0)).not.toThrow()
    expect(pool.size).toBe(0)
  })
})

describe('scheduleClick (ADR-010)', () => {
  it('builds an oscillator + gain envelope at the given time into the output node', () => {
    const ctx = new FakeAudioContext()
    const out = new FakeGain()
    const plan = clickPlan(true)
    const { source, nodes } = scheduleClick(asCtx(ctx), out as unknown as AudioNode, plan, 2)
    const osc = ctx.oscillators[0]!
    const gain = ctx.gains[0]!
    expect(source).toBe(osc as unknown as OscillatorNode)
    expect(nodes).toHaveLength(2)
    expect(osc.type).toBe('triangle')
    expect(osc.frequency.value).toBe(1500)
    expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(0, 2)
    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(plan.peakGain, 2 + plan.attackS)
    expect(gain.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.0001, 2 + plan.durationS)
    expect(osc.connect).toHaveBeenCalledWith(gain)
    expect(gain.connect).toHaveBeenCalledWith(out)
    expect(osc.startAt).toBe(2)
    expect(osc.stopAt).toBeCloseTo(2 + plan.durationS + 0.005, 12)
  })
})

describe('audio/context (ADR-009)', () => {
  it('getAudioContextCtor is re-exported from the tuner path unchanged', () => {
    expect(fromTuner).toBe(fromAudio)
  })

  it('readOutputClock reads only what the context supports', () => {
    const ctx = new FakeAudioContext()
    ctx.currentTime = 3
    expect(readOutputClock(asCtx(ctx), 100)).toEqual({ currentTime: 3, perfNow: 100 })
    ctx.outputLatency = 0.1
    ctx.baseLatency = 0.01
    ctx.getOutputTimestamp = vi.fn(() => ({ contextTime: 2.9, performanceTime: 90 }))
    expect(readOutputClock(asCtx(ctx), 100)).toEqual({
      currentTime: 3, perfNow: 100, outputLatency: 0.1, baseLatency: 0.01, timestamp: { contextTime: 2.9, performanceTime: 90 },
    })
  })

  it('readOutputClock survives a throwing getOutputTimestamp', () => {
    const ctx = new FakeAudioContext()
    ctx.getOutputTimestamp = () => {
      throw new Error('nope')
    }
    expect(readOutputClock(asCtx(ctx), 0).timestamp).toBeUndefined()
  })
})

