import type { ClickPlan } from '~/utils/metronome/clickPlan'
import { CLICK_STOP_PAD_S } from '~/utils/metronome/params'

/**
 * 依 ClickPlan 在 AudioContext 時間 time 排一個 click（ADR-010、§4.3，無 Vue）。
 * 回傳的節點交給 voicePool 追蹤；本函式不建立、不關閉 context。
 */
export function scheduleClick(ctx: BaseAudioContext, out: AudioNode, plan: ClickPlan, time: number): { source: OscillatorNode; nodes: AudioNode[] } {
  const osc = ctx.createOscillator()
  osc.type = plan.type
  osc.frequency.value = plan.frequency
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0, time)
  gain.gain.linearRampToValueAtTime(plan.peakGain, time + plan.attackS)
  gain.gain.exponentialRampToValueAtTime(0.0001, time + plan.durationS)
  osc.connect(gain)
  gain.connect(out)
  osc.start(time)
  osc.stop(time + plan.durationS + CLICK_STOP_PAD_S)
  return { source: osc, nodes: [osc, gain] }
}
