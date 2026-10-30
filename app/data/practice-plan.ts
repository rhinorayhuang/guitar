import type { PracticeStage } from '~/types/chord'

export const practicePlan: PracticeStage[] = [
  {
    id: 'stage-1', title: '第一個和弦', chords: ['Em-open', 'E-open'],
    transitions: [['Em-open', 'E-open']], targetBpm: 60, dailyMinutes: 10,
    completion: '1 分鐘內 Em↔E 換 30 次，每條弦都清楚發聲',
    tips: ['每天短時間練習，讓指尖慢慢長繭'],
    theoryNote: 'Em 和 E 只差一個音：E 多了食指按第 3 弦第 1 格，把空弦的 G 升高半音變成 G#。這個決定明暗的音叫「三度音」，離根音 E 遠一點（G#）聽起來明亮，是大和弦；近一點（G）聽起來偏暗，是小和弦。',
  },
  {
    id: 'stage-2', title: '同手型移動', chords: ['Am-open', 'E-open'],
    transitions: [['Am-open', 'E-open']], targetBpm: 60, dailyMinutes: 10,
    completion: '1 分鐘內 Am↔E 換 30 次，沒有悶音',
    tips: ['中指和無名指當成一組一起移動'],
    theoryNote: '把 E 的指法整排往細弦移一條就是 Am，最低音也從第 6 弦空弦 E 換成第 5 弦空弦 A，所以根音跟著換了。吉他只有第 3、2 弦之間的音距比其他相鄰弦近半音，食指移到第 2 弦第 1 格按出的是 C，而不是「照搬」該有的 C#，少這半音就讓明亮的 E 變成偏暗的 Am。',
  },
  {
    id: 'stage-3', title: '三指和弦', chords: ['D-open', 'A-open'],
    transitions: [['D-open', 'A-open'], ['A-open', 'E-open']], targetBpm: 60, dailyMinutes: 15,
    completion: '60 BPM 每小節換一次，D↔A 連續 16 小節不中斷',
    tips: ['D 只刷 4 條弦，刷之前先看準起點'],
  },
  {
    id: 'stage-4', title: '最難的開放和弦轉換', chords: ['G-open', 'C-open'],
    transitions: [['G-open', 'C-open'], ['C-open', 'Am-open']], targetBpm: 60, dailyMinutes: 15,
    completion: '60 BPM 每小節換一次，G↔C 連續 16 小節不中斷',
    tips: ['這一關通常要花最久，慢下來比硬衝更快'],
  },
  {
    id: 'stage-5', title: '第一首和弦進行', chords: ['C-open', 'G-open', 'Am-open', 'Dm-open', 'Em-open'],
    transitions: [['C-open', 'G-open'], ['G-open', 'Am-open'], ['Am-open', 'Dm-open']], targetBpm: 70, dailyMinutes: 20,
    completion: 'C–G–Am–Dm 進行在 70 BPM 連續彈 4 輪',
    tips: ['先用全音符刷一下，再改成八分音符刷法'],
    theoryNote: '這一關的 C、G、Am、Dm、Em 用到的音全都在 C 大調音階（C D E F G A B）裡，是同一個「家族」，所以放在一起特別和諧。從 C 開始數，它們落在第 1、5、6、2、3 個音上，樂理寫成 I、V、vi、ii、iii（大寫是大和弦、小寫是小和弦）。',
  },
  {
    id: 'stage-6', title: '第一個封閉和弦', chords: ['F-barre'],
    transitions: [['C-open', 'F-barre']], targetBpm: 50, dailyMinutes: 15,
    completion: 'F 和弦 6 條弦都清楚，C↔F 在 50 BPM 連續 8 小節',
    tips: ['先只練食指封閉 6 條弦，聽到每條弦都響再加其他手指'],
  },
]
