import { silentModeHint } from '~/data/audio-copy'

/** 節拍器文案（metronome-architecture.md §8）。最終字句由 Design 微調，語意不可變 */
export const metronomeCopy = {
  title: '節拍器',
  bpmUnit: 'BPM',
  start: '開始',
  stop: '停止',
  starting: '啟動中…',
  paused: '節拍器已暫停，點一下繼續',
  unsupported: '這個瀏覽器不支援節拍器',
  silentModeHint,
  playLabel: '播放節拍器',
  decrease: (n: number) => `減少 ${n} BPM`,
  increase: (n: number) => `增加 ${n} BPM`,
  stageButton: (bpm: number) => `用 ${bpm} BPM 練習`,
  stageTarget: (stageNumber: number) => `第 ${stageNumber} 關目標速度`,
  beatLabel: (beatNumber: number) => `第 ${beatNumber} 拍`,
} as const
