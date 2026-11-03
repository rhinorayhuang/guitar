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
  // 第 7–12 關（docs/stages-7-plus-draft.md A 組，guitar-teacher 設計）：只用已學過的和弦
  {
    id: 'stage-7', title: '鐘擺式上下刷', chords: ['Em-open', 'Am-open'],
    transitions: [['Em-open', 'Am-open']], targetBpm: 60, dailyMinutes: 15,
    completion: '60 BPM 每拍「下、上」各刷一次：Em 連續 8 小節手不停，再 Em↔Am 每 2 小節換一次、連續 8 小節不中斷',
    tips: [
      '手臂像鐘擺一樣一直上下擺：下刷落在拍點上，上刷落在兩拍中間',
      '上刷只要掃到細的 3、4 條弦就夠了，不用每次 6 條全刷',
      '嘴巴跟著數「1 與 2 與 3 與 4 與」，數字下刷、「與」上刷',
    ],
    theoryNote: '八分音符就是把一拍平均切成兩半：數「1 與 2 與」，數字落在下刷，「與」落在上刷。4/4 拍一小節有 4 拍，所以一小節剛好刷 8 下。',
    strumPattern: 'DUDUDUDU',
  },
  {
    id: 'stage-8', title: '換和弦不停拍', chords: ['C-open', 'G-open', 'Am-open', 'Dm-open'],
    transitions: [['C-open', 'G-open'], ['G-open', 'Am-open'], ['Am-open', 'Dm-open'], ['Dm-open', 'C-open']],
    targetBpm: 60, dailyMinutes: 15,
    completion: '60 BPM 八分音符上下刷，C–G–Am–Dm 每小節換一次，連續 4 輪（16 小節）右手不停，每小節第 1 拍都刷在新和弦上',
    tips: [
      '每小節最後一下上刷可以刷空弦，左手趁這半拍提早離開、去按下一個和弦',
      '先求右手不停，左手晚一點按好沒關係，練幾天就會對齊',
      '換和弦時眼睛先看下一個和弦的第一根手指要放哪裡',
    ],
    theoryNote: '音樂的時間不會為了換和弦停下來，所以寧可最後半拍刷空弦，也要讓下一小節的第 1 拍準時落下。節拍器的重音就是第 1 拍，提醒你和弦要在這裡換好。',
    strumPattern: 'DUDUDUDU',
  },
  {
    id: 'stage-9', title: 'G 調的四和弦進行', chords: ['G-open', 'D-open', 'Em-open', 'C-open'],
    transitions: [['G-open', 'D-open'], ['D-open', 'Em-open'], ['Em-open', 'C-open'], ['C-open', 'G-open']],
    targetBpm: 70, dailyMinutes: 20,
    completion: '70 BPM 八分音符上下刷，G–D–Em–C 每小節換一次，連續 4 輪（16 小節）不中斷',
    tips: [
      'G 換 D：無名指從第 1 弦第 3 格移到第 2 弦第 3 格，只跨一條弦，讓它先落下帶路',
      'D 只刷 4 條弦、G 和 Em 刷 6 條：換到 D 時，右手的起點往細弦移',
      'D 換 Em：放開 D 的三根手指，中指和無名指一起放到第 5、4 弦第 2 格',
    ],
    theoryNote: 'G、D、Em、C 用到的音全都在 G 大調音階裡，從 G 數起落在第 1、5、6、4 個音，寫成 I–V–vi–IV。前三個 I–V–vi 和第 5 關的 C–G–Am 是同一種關係，只是整組換成以 G 為家。',
    strumPattern: 'DUDUDUDU',
  },
  {
    id: 'stage-10', title: '第一個節奏型', chords: ['G-open', 'D-open', 'Em-open', 'C-open'],
    transitions: [['G-open', 'D-open'], ['D-open', 'Em-open'], ['Em-open', 'C-open'], ['C-open', 'G-open']],
    targetBpm: 60, dailyMinutes: 20,
    completion: '60 BPM 每小節都用「下、下上、上下上」（第 3 拍空揮不碰弦），G–D–Em–C 每小節換一次，連續 4 輪（16 小節）不中斷',
    tips: [
      '節奏型對應「1、2 與、與 4 與」：第 3 拍手照樣往下揮，只是不碰弦',
      '先用一個和弦（G）把節奏型刷到不用想，再加入換和弦',
      '穩了以後可以把節拍器加到 70，第 12 關會用 70',
    ],
    theoryNote: '節奏型就是一小節裡固定「哪幾下刷到弦」：第 3 拍的下刷手照樣揮、只是不碰弦，後面的上刷才會準時落在「與」上。落在「與」上的刷弦讓重音離開拍點，這種往前推的感覺叫切分。',
    strumPattern: 'D.DU.UDU',
  },
  {
    id: 'stage-11', title: '把 F 放進進行', chords: ['C-open', 'G-open', 'Am-open', 'F-barre'],
    transitions: [['C-open', 'G-open'], ['G-open', 'Am-open'], ['Am-open', 'F-barre'], ['F-barre', 'C-open']],
    targetBpm: 60, dailyMinutes: 20,
    completion: '60 BPM 八分音符上下刷，C–G–Am–F 每小節換一次，連續 4 輪（16 小節）不中斷，F 每次至少 5 條弦清楚',
    tips: [
      'Am 換 F：食指本來就在第 2 弦第 1 格，讓它留在原位放平、壓滿 6 條弦，再放其他手指',
      '封閉和弦每次練 5 分鐘就休息一下，今天的 20 分鐘可以分成三四段',
      '換到 F 那一小節，前一下上刷放空弦、讓左手提早出發',
    ],
    theoryNote: 'C–G–Am–F 和第 9 關的 G–D–Em–C 是同一個進行 I–V–vi–IV，只是換到 C 調。換調時級數的順序不變，和弦名稱整組一起平移。',
    strumPattern: 'DUDUDUDU',
  },
  {
    id: 'stage-12', title: '第一首完整的歌', chords: ['G-open', 'D-open', 'Em-open', 'C-open'],
    transitions: [
      ['G-open', 'C-open'], ['G-open', 'D-open'], ['D-open', 'Em-open'], ['Em-open', 'C-open'],
      ['C-open', 'G-open'], ['D-open', 'G-open'], ['C-open', 'Em-open'], ['C-open', 'D-open'],
    ],
    targetBpm: 70, dailyMinutes: 20,
    completion: '70 BPM 從前奏彈到尾奏共 40 小節不中斷，主歌和副歌照段落換刷法',
    // 段落與每段刷法畫在練習頁（sections），tips 只留段落表看不出來的提醒
    tips: [
      '主歌刷得少、副歌刷得滿：換段落時右手換刷法，左手的和弦照常每小節換',
      '最後一下讓它響到聲音消失',
      '70 太快就先用 60 從頭彈到尾，能不中斷比速度重要',
    ],
    theoryNote: '一首歌常分成前奏、主歌、副歌、尾奏，主歌刷得少、副歌刷得滿，聽的人就感覺得到起伏。這首的主歌 Em–C–G–D 和副歌 G–D–Em–C 是同樣四個和弦，只是從不同的地方開始繞。',
    // 自編練習曲，未引用任何真實歌曲（vision-roadmap R-13）
    sections: [
      { name: '前奏', bars: 4, progression: ['G-open', 'C-open', 'G-open', 'D-open'], strum: 'D.......' },
      { name: '主歌 1', bars: 8, progression: ['Em-open', 'C-open', 'G-open', 'D-open', 'Em-open', 'C-open', 'G-open', 'D-open'], strum: 'D.D.D.D.' },
      { name: '副歌 1', bars: 8, progression: ['G-open', 'D-open', 'Em-open', 'C-open', 'G-open', 'D-open', 'Em-open', 'C-open'], strum: 'D.DU.UDU' },
      { name: '主歌 2', bars: 8, progression: ['Em-open', 'C-open', 'G-open', 'D-open', 'Em-open', 'C-open', 'G-open', 'D-open'], strum: 'D.D.D.D.' },
      { name: '副歌 2', bars: 8, progression: ['G-open', 'D-open', 'Em-open', 'C-open', 'G-open', 'D-open', 'Em-open', 'C-open'], strum: 'D.DU.UDU' },
      { name: '尾奏', bars: 3, progression: ['C-open', 'D-open', 'G-open'], strum: 'D.DU.UDU' },
      { name: '結尾', bars: 1, progression: ['G-open'], strum: 'D.......' },
    ],
  },
]
