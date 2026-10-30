/**
 * 追蹤已排程、尚未結束的音源（§4.3，無 Vue）。onended 時斷開相關節點並移除；
 * silenceAll 用在停止時：context 隨後會被關閉，onended 可能不會觸發，所以立即斷開並清空。
 */

export interface VoicePool {
  add(source: AudioScheduledSourceNode, nodes: AudioNode[]): void
  silenceAll(at: number): void
  readonly size: number
}

interface Voice { source: AudioScheduledSourceNode; nodes: AudioNode[] }

function disconnectAll(nodes: AudioNode[]) {
  for (const node of nodes) {
    try {
      node.disconnect()
    }
    catch { /* 已斷開或 context 已關閉 */ }
  }
}

export function createVoicePool(): VoicePool {
  const voices = new Set<Voice>()
  return {
    add(source, nodes) {
      const voice: Voice = { source, nodes }
      voices.add(voice)
      source.onended = () => {
        source.onended = null
        disconnectAll(nodes)
        voices.delete(voice)
      }
    },
    silenceAll(at) {
      for (const { source, nodes } of voices) {
        source.onended = null
        try {
          source.stop(at) // 已在播或尚未開始的都適用；以最後一次為準
        }
        catch { /* context 已關閉 */ }
        disconnectAll(nodes)
      }
      voices.clear()
    },
    get size() {
      return voices.size
    },
  }
}
