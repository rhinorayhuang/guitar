# 播放時鐘＋節拍器技術架構（`/practice` 節拍器面板）

**Status**: Proposed  **對應 PRD**: `docs/prd.md` v0.5 §3 P1 第一項（PA-08）、TUN-94；`docs/vision-roadmap.md` §4 T2、§6、R-06  **Last Updated**: 2026-10-29
**讀者**: frontend-developer（實作）、Eng Lead（審查）、產品負責人（§12 有待決定事項）
**沿用**: `docs/architecture.md`（調音器）的分層、純度規則、生命週期與測試慣例。本文件的 ADR 接續調音器編號（ADR-008 起）。

本文件是節拍器第一版的**實作藍圖**，同時定義一個可重用的**播放時鐘**，供階段 1 節奏教學與階段 3 起的編曲器回放共用。數值一律以 `app/utils/clock/params.ts`、`app/utils/metronome/params.ts` 為準，本文件的數字是初始值。

---

## 0. 結論摘要

| 主題 | 決定 | ADR |
|------|------|-----|
| 時鐘模型 | 純函式**時間軸**：`錨點（step, time, bpm）＋ 整數步號`，任一步的時間 = `anchor.time + (step − anchor.step) × 每步秒數`，**不累加浮點數** | ADR-008 |
| 排程方式 | **lookahead 排程**：計時器每 **25 ms** 喚醒，把未來 **100 ms** 內的拍子用 `osc.start(t)`（AudioContext 時間）排進音訊執行緒；計時器**只負責喚醒，不發聲** | ADR-008 |
| 改速度 | 下一個**尚未排程**的拍子生效：它與前一拍的間隔就是新速度；已排程的拍子不改 | ADR-008 |
| 計時器延遲 | **跳拍不補拍**：已過期（晚於容忍 10 ms）的拍子直接略過並計數，下一拍仍落在原本的格線上；以 O(1) 公式跳過，不逐拍迴圈 | ADR-008 |
| 發聲 | 每拍一組 `OscillatorNode + GainNode`（約 40–50 ms 的短包絡），重音＝較高音高＋較大音量；`onended` 時斷開；全部經過一個 master gain | ADR-010 |
| 視覺同步 | `requestAnimationFrame` 讀「可聽時間」：優先 `getOutputTimestamp()` 外推，否則 `currentTime − outputLatency − baseLatency`；用「已排程拍子佇列」決定目前亮哪一拍 | ADR-011 |
| AudioContext 擁有權 | **每個功能頁各自擁有、各自釋放**（頁面層 composable 是唯一擁有者），**不做** app 層級共用 context | ADR-009 |
| 生命週期 | 手勢內建立＋`resume()`；`stop`、`visibilitychange:hidden`、`pagehide`、`onBeforeUnmount`、context 被中斷 → 一律完整釋放（`ctx.close()`）；回前景**不自動重啟** | ADR-009 |
| UI | 練習頁**單一共用面板**，行動裝置**常駐底部**（精簡列）；各關「用 N BPM 練習」按鈕把 `targetBpm` 帶入並開始播放；BPM 30–200，±1／±5 | ADR-012 |
| 程式位置 | 時鐘純邏輯 `app/utils/clock/`（給編曲器重用）、節拍器純邏輯 `app/utils/metronome/`；瀏覽器轉接 `app/composables/audio/`（共用）與 `app/composables/useMetronome.ts` | ADR-008 |

---

## 1. 範圍

**第一版做**：播放時鐘（lookahead 排程）、開始／停止、4/4 第 1 拍重音、與聲音對齊的跟拍視覺、練習頁各關「用 N BPM 練習」（`targetBpm`：60/60/60/60/70/50）、BPM 手動加減、iOS 靜音提示（同 TUN-94 文案）、切背景停止。

**第一版不做**：tap tempo、細分拍（時鐘本身支援 `stepsPerBeat`，但 UI 不開放）、換和弦計時器、其他拍號、記住上次 BPM、跨頁面持續播放、延遲手動校正。

**非功能目標**（實機驗收，見 §11）：
- 拍點時間由音訊時鐘決定，連續播放 10 分鐘，相鄰拍間隔與理論值差 ≤ 1 ms（即音訊執行緒的取樣精度），**無累積漂移**。
- 一般使用下（前景、非低耗電）10 分鐘內 `skippedSteps = 0`。
- 視覺亮燈與聽到聲音的時間差：在瀏覽器回報正確延遲的裝置上 ≤ 1 個畫面（約 17–33 ms）。

---

## 2. 依賴方向與模組總覽

依賴只能由外往內，與調音器相同。

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 呈現層  app/pages/practice.vue（擁有 useMetronome 實例）                     │
│         app/components/metronome/MetronomePanel.vue                       │
│         ├─ MetronomeBpmControl.vue   └─ MetronomeBeatIndicator.vue        │
└───────────────▲──────────────────────────────────────────────────────────┘
                │  只讀 ref、呼叫動作
┌───────────────┴──────────────────────────────────────────────────────────┐
│ 轉接層（Vue）  app/composables/useMetronome.ts                              │  AudioContext 唯一擁有者、生命週期、rAF
└───────────────▲──────────────────────────────────────────────────────────┘
                │
┌───────────────┴──────────────────────────────────────────────────────────┐
│ 轉接層（瀏覽器 API，無 Vue）                                                 │
│  ★ app/composables/audio/context.ts     getAudioContextCtor、readOutputClock │
│  ★ app/composables/audio/scheduler.ts   計時器喚醒 + 呼叫純時間軸 + onStep    │
│  ★ app/composables/audio/voicePool.ts   追蹤已排程節點、ended 回收、全部靜音   │
│    app/composables/metronome/clickVoice.ts   依 ClickPlan 建 Oscillator+Gain │
└───────────────▲──────────────────────────────────────────────────────────┘
                │  只傳數字（currentTime、latency、step、time）
┌───────────────┴──────────────────────────────────────────────────────────┐
│ 純邏輯（Node 可測，不得 import vue / #imports / 瀏覽器全域 / 計時器）         │
│  ★ app/utils/clock/params.ts      LOOKAHEAD_S、WAKE_INTERVAL_MS…           │
│  ★ app/utils/clock/tempo.ts       BPM 範圍、clampBpm、secondsPerStep        │
│  ★ app/utils/clock/timeline.ts    createTimeline、planWindow、changeTempo   │
│  ★ app/utils/clock/audibleTime.ts estimateAudibleTime                       │
│  ★ app/utils/clock/stepQueue.ts   已排程步佇列 → 目前可聽的步               │
│    app/utils/metronome/params.ts  BPM 步進、BEATS_PER_BAR、click 參數        │
│    app/utils/metronome/beats.ts   beatOf(step) → { beatInBar, accent }     │
│    app/utils/metronome/clickPlan.ts  clickPlan(accent) → ClickPlan          │
└──────────────────────────────────────────────────────────────────────────┘
資料：app/data/practice-plan.ts（targetBpm）、app/data/audio-copy.ts（靜音提示，與調音器共用）
★ = 編曲器回放要重用的檔案（§7.3）
```

規則（code review 檢查項，`tests/purity.spec.ts` 掃描強制）：
- `app/utils/clock/**`、`app/utils/metronome/**`：與 `app/utils/tuner/**` 同規則（不 import `vue`／`#imports`／`#app`，不碰 `window`／`navigator`／`document`／`AudioContext`／`localStorage`／`Date.now`／`performance.now`），**另外**禁止 `setTimeout`／`setInterval`／`requestAnimationFrame`。時間一律由參數傳入。
- **PA-08 掃描**：整個 `app/` 只有 `app/composables/audio/scheduler.ts` 可以出現 `setInterval`，而且它只呼叫 `tick()`，不建立任何音訊節點（掃描：該檔不得出現 `createOscillator|createBufferSource|start\(`）。
- `app/composables/audio/**` 不 import `vue`，也不依賴 `metronome/`、`tuner/`（給編曲器重用）。`clock/` 不依賴 `metronome/`。
- 子目錄不會被 Nuxt auto-import，一律明確 import；composable 與 metronome 元件明確 import `vue` API 與子元件（ADR-006）。

---

## 3. 播放時鐘

### 3.1 為什麼不能用 `setInterval` 發聲

主執行緒計時器會被版面配置、GC、Vue 重繪延遲 5–50 ms，手機上更差，且延遲會在拍與拍之間不規則地出現；而 AudioContext 的時間由音訊硬體驅動，`osc.start(t)` 可以精準到取樣。所以把「決定何時發聲」交給音訊時鐘，計時器只負責「提早把接下來的拍子交給音訊執行緒」。這就是 lookahead 排程。

```
主執行緒  ──┬────────┬────────┬────────┬───  每 25 ms 喚醒 tick()
             │        │        │        │
             ▼        ▼        ▼        ▼
         planWindow(now, now+100ms)：把 time < now+100ms 且未排過的步交出
             │
             ▼
音訊執行緒  ────────●──────────────────●─────  osc.start(t)，取樣精準
                   step n            step n+1
```

### 3.2 時間軸模型（純函式，`app/utils/clock/timeline.ts`）

- **步（step）**：整數，從 0 開始。`stepsPerBeat` 決定一步代表多長：節拍器 = 1（一拍一步，四分音符）；編曲器 = 2（八分音符網格）。
- **錨點（anchor）**：`{ step, time, bpm }`，表示「第 `step` 步發生在 AudioContext 時間 `time`，從這裡起速度為 `bpm`」。
- **步時間**：`stepTime(s) = anchor.time + (s − anchor.step) × secondsPerStep(anchor.bpm, stepsPerBeat)`。

**長時間累積誤差**：時間永遠由「錨點 + 整數 × 每步秒數」**一次乘法**算出，不做 `nextTime += spb` 的累加。累加 1 小時（3600 次）在 60 BPM 下誤差雖只有約 1e-12 s，但在變速、跳拍、多次重錨點時會混入額外分支；用公式後每一拍的誤差都與播放時長無關（只有一次乘法與一次加法的捨入，約 1e-13 s）。只有改速度時才會建立新錨點，新錨點的時間也是由公式算出的。

### 3.3 參數與取值理由（`app/utils/clock/params.ts`）

| 參數 | 值 | 理由 |
|------|----|------|
| `WAKE_INTERVAL_MS` | 25 | 喚醒週期。要遠小於 lookahead，讓一次喚醒延遲（GC、重繪）不會造成漏拍；25 ms 每秒 40 次，`tick()` 只做幾次乘法，成本可忽略。 |
| `LOOKAHEAD_S` | 0.100 | 排程視窗。可吸收約 75 ms（= 100 − 25）的單次主執行緒停頓而不漏拍，涵蓋手機上常見的重繪／GC 停頓。缺點是改速度最多延後 100 ms 生效：最快 200 BPM 一拍 300 ms，視窗內最多已排 1 拍，所以「下一拍」仍是使用者能感知的下一拍。不取 200 ms 以上：停止時已排程的拍要多取消、且改速度延後感明顯。 |
| `LATE_TOLERANCE_S` | 0.010 | 已過期但晚不到 10 ms 的拍子仍排程（Web Audio 會「立即播放」，晚 ≤ 10 ms 聽不出來）；更晚的跳過。`currentTime` 以 128 取樣（約 2.7 ms）為單位前進，容忍值需大於數個區塊。 |
| `START_DELAY_S` | 0.100 | 第一拍 = `resume()` 完成後的 `currentTime + 0.1`。給排程與 iOS 音訊路由初始化的餘裕，避免第一拍被吃掉或過短。 |
| `MIN_LEAD_S` | 0.020 | 改速度時，新的下一拍最早不早於 `now + 0.02`（見 §3.5）。 |
| `MAX_LATENCY_S` | 0.500 | 視覺對時採用的輸出延遲上限，防止瀏覽器回報異常值（見 §5）。 |

### 3.4 `planWindow`：每次喚醒要排哪些步

輸入：時間軸狀態、`now`（`ctx.currentTime`）、`horizon`（= `now + LOOKAHEAD_S`）。輸出：新狀態、`due: { step, time }[]`、`skipped: number`。

演算法：
1. `s = state.nextStep`。
2. **跳拍檢查（O(1)）**：若 `stepTime(s) < now − LATE_TOLERANCE_S`，算出第一個不過期的步 `s' = anchor.step + ceil((now − LATE_TOLERANCE_S − anchor.time) / spb)`（取 `max(s', s)`，再以 `stepTime(s') < now − tol` 時 `s'++` 修正浮點邊界），`skipped = s' − s`，`s = s'`。
3. 當 `stepTime(s) < horizon`：加入 `due`、`s++`。
4. 回傳 `nextStep = s`；`lastScheduled = due 的最後一筆（若有）`。

性質（皆有測試）：同一步不會被交出兩次；不會漏掉任何不過期的步；跳過的步之後仍在原格線上；暫停數小時後喚醒也只做常數次運算。

**為什麼跳拍而不補拍或重新對齊**：
- 補拍（把過期的拍立刻全部播出）會在一瞬間連響數聲，比漏一拍更干擾。
- 重新對齊（把格線平移到現在）會產生一個長度不對的拍間隔，而且編曲器回放時會讓三個聲部的位置與歌曲位置錯開。
- 跳拍讓節奏「漏一聲但不走調」，對跟拍練習與日後回放都最安全；並且計數讓實機測試能觀察（§11）。

### 3.5 播放中改 BPM（`changeTempo(state, bpm, now)`）

規則：**下一個尚未排程的步生效，且它與前一拍的間隔就是新速度**；已排程（已交給音訊執行緒）的步不改，因此不跳拍、也不會出現重疊的兩聲。

```
prev = state.lastScheduled            // 已排程的最後一步 { step, time }；被跳過的步不算
若 prev 為 null：
  若 nextStep == anchor.step（沒排也沒跳過任何步）：只換 bpm，錨點 time 不變（第一拍時間不受影響）
  否則（第一次交出前就跳過了步）：anchor = { step: nextStep, time: max(舊格線的 stepTime(nextStep), now + MIN_LEAD_S), bpm: newBpm }
否則：
  t = max(prev.time + secondsPerStep(newBpm), now + MIN_LEAD_S)
  anchor = { step: nextStep, time: t, bpm: newBpm }   // 錨點用 nextStep（不是 prev.step + 1），跳過的步不會重新出現
```

> **修訂（code review #1）**：實作初版曾用 `prev.time + (nextStep − prev.step) × 新拍長`。卡頓跳過 k 步、而那次喚醒沒排到任何拍時，從 200 改成 30 BPM 會被放大成數十秒的靜音（probe：卡頓 10 s → 靜音約 60 s）。被跳過的步已不存在，所以間隔只算一個新拍長；`max(…, now + MIN_LEAD_S)` 會把過去的時間拉回現在之後。

`max(…, now + MIN_LEAD_S)` 處理「從很慢改成很快」：例如 30 BPM（2 s 一拍）上一拍在 1.5 s 前，改成 200 BPM 時 `prev.time + 0.3` 已是過去，這時下一拍落在現在之後 20 ms，而不是被當成過期跳掉。這一拍間隔會比新速度長，但不會漏拍。

視窗內已排的拍：因 `LOOKAHEAD_S` 最多 100 ms，最壞情況是使用者按下時「下一拍」已在 100 ms 內排好，那一拍維持舊速度，再下一拍才是新速度。這在聽感上就是「下一拍」，不做取消重排（取消已排程節點會增加狀態且易出現漏聲）。

### 3.6 瀏覽器端 scheduler（`app/composables/audio/scheduler.ts`）

- `start()`：`timeline = createTimeline({ startTime: ctx.currentTime + START_DELAY_S, bpm, stepsPerBeat })`，立即 `tick()` 一次，再 `setInterval(tick, WAKE_INTERVAL_MS)`。
- `tick()`：**冪等**。讀 `ctx.currentTime` → `planWindow` → 對每個 `due` 呼叫 `onStep(step, time)`（以 try/catch 包住，consumer 的錯誤不能停掉時鐘；`console.warn` 一次）→ 更新 `stats`。可以由多個來源呼叫：計時器之外，`useMetronome` 的 rAF 迴圈每畫面也呼叫一次，當作第二個喚醒來源（計時器被節流時 rAF 常仍在跑，反之亦然；重複呼叫不會重複排程）。
- `setBpm(bpm)`：`changeTempo(timeline, clampBpm(bpm), ctx.currentTime)`。未執行時只記下 bpm。
- `stop()`：`clearInterval`，冪等。**不負責靜音**——已排程節點由擁有者透過 `voicePool.silenceAll` 處理（排程與發聲分離）。
- `stats`：`{ skippedSteps, maxWakeGapMs }`，`maxWakeGapMs` 以 `ctx.currentTime` 差計算。給實機測試頁讀取（開發模式下以 `?debug=clock` 顯示），不做 analytics。
- 計時器函式可注入（測試用），預設 `globalThis.setInterval`。
- 若 `ctx.state !== 'running'`，`tick()` 不排程（`currentTime` 不前進，排了也沒意義），由擁有者處理中斷。

不採用 Web Worker 計時器（主執行緒被節流時仍準時）：第一版切背景就停止，前景的主要風險是短暫停頓，100 ms 視窗已足夠；Worker 會增加檔案與 SSR／打包設定。若實機在低耗電模式出現 `skippedSteps > 0`，依 §11 的備案處理。

---

## 4. 發聲

### 4.1 選擇：每拍一組 OscillatorNode ＋ GainNode

| 選項 | 優點 | 缺點 |
|------|------|------|
| **A. Oscillator + Gain 包絡（採用）** | 不需預先產生資料；與調音器參考音同一套做法；fakeAudio 已能記錄 oscillator；音色參數化容易調 | 每拍建立 2 個節點（每秒 ≤ 3.3 拍，成本可忽略） |
| B. 預先產生短 AudioBuffer，每拍一個 `AudioBufferSourceNode` | 可做出帶雜訊的「木魚」質感；每拍 1 個節點 | 要在純函式產生樣本並在 context 建立後轉成 buffer；`sampleRate` 依裝置而變需重算；測試要多一種 fake |

編曲器回放也是「合成音色 + 每個音一組節點」（vision §6.2 第 5 點），A 與之一致。

### 4.2 Click 參數（`app/utils/metronome/clickPlan.ts`，數值在 `params.ts`）

```ts
export interface ClickPlan {
  frequency: number   // Hz
  type: 'sine' | 'triangle' | 'square'
  peakGain: number    // 0–1
  attackS: number     // 線性上升
  durationS: number   // 指數衰減到 0.0001 的時間
}
export function clickPlan(accent: boolean): ClickPlan
```

| | 重音（第 1 拍） | 一般拍 |
|---|---|---|
| frequency | 1500 Hz | 1000 Hz |
| type | `'triangle'` | `'triangle'` |
| peakGain | 0.8 | 0.45 |
| attackS | 0.001 | 0.001 |
| durationS | 0.05 | 0.04 |

重音同時用**音高與音量**兩種差異（不只靠其中一種，對聽力較弱或手機喇叭頻響差的人都分得出來）。頻率選 1–1.5 kHz：手機喇叭在此範圍效率高，且與吉他基頻（82–330 Hz）分得開，彈琴時仍聽得到。實機可微調（§11）。

### 4.3 每拍的節點生命週期（`clickVoice.ts` + `voicePool.ts`）

```
onStep(step, time):
  { accent } = beatOf(step, BEATS_PER_BAR)
  plan = clickPlan(accent)
  osc  = ctx.createOscillator(); osc.type = plan.type; osc.frequency.value = plan.frequency
  gain = ctx.createGain()
  gain.gain.setValueAtTime(0, time)
  gain.gain.linearRampToValueAtTime(plan.peakGain, time + plan.attackS)
  gain.gain.exponentialRampToValueAtTime(0.0001, time + plan.durationS)
  osc.connect(gain); gain.connect(master)
  osc.start(time); osc.stop(time + plan.durationS + 0.005)
  pool.add(osc, [osc, gain])          // onended → disconnect 兩者、從 pool 移除
  stepQueue.push({ step, time, beatInBar })   // 給視覺用
```

- `master`：每次 `start()` 建一個 `GainNode(1) → ctx.destination`，所有 click 接到它；停止時一起斷開。
- `voicePool`：以 `Set` 追蹤尚未結束的 source；`onended` 時 `disconnect()` 所有相關節點並移除。正常播放時 pool 大小 ≤ 3（視窗內最多 1–2 拍 + 正在響的 1 拍），測試會檢查長時間不成長。
- `silenceAll(at)`：`master.gain.setValueAtTime(0, at)`；對每個 source `stop(at)`（已在播或尚未開始的都適用；`stop` 可重複呼叫，以最後一次為準）；立即 `disconnect` 並清空 pool（context 隨後會被關閉，`onended` 可能不會觸發，不能依賴它）。
- 不重用 OscillatorNode（規格上 `start()` 只能呼叫一次）。

### 4.4 停止時的順序

`teardown()`（冪等）：
1. `scheduler.stop()`（清計時器）
2. `cancelAnimationFrame(rafId)`
3. `pool.silenceAll(ctx.currentTime)`；`master.disconnect()`
4. 清空 `stepQueue`；`currentBeat = null`
5. 移除 `ctx.onstatechange`；`ctx.close()`（catch）並設為 `null`
6. 釋放 Screen Wake Lock（D-M2 已採用，見 §12.2）

立即 `close()` 可能在一個正在響的 click 中段切斷，造成極小的爆音；click 只有 40–50 ms，機率約 4–15%（依 BPM）且聲音已在衰減，第一版接受。若實機明顯，再改成「master 5 ms 淡出後延遲 30 ms 才 close」（只用在使用者按停止，不用在 pagehide）。

---

## 5. 視覺同步

### 5.1 「可聽時間」估計（`app/utils/clock/audibleTime.ts`，純函式）

排在 AudioContext 時間 `t` 的聲音，要再經過輸出延遲才從喇叭出來。所以要問的是「此刻喇叭正在播哪個 context 時間」。

```ts
export interface OutputClockSample {
  currentTime: number
  outputLatency?: number        // 未支援時 undefined
  baseLatency?: number
  timestamp?: { contextTime: number; performanceTime: number }  // getOutputTimestamp()
  perfNow: number               // rAF 給的 DOMHighResTimeStamp（ms）
}
export function estimateAudibleTime(s: OutputClockSample, maxLatencyS = MAX_LATENCY_S): number
```

規則：
1. 若 `timestamp` 有效（`contextTime > 0` 且 `performanceTime > 0`，兩者皆有限數）：`audible = contextTime + (perfNow − performanceTime) / 1000`。這是規格中「正在輸出的 context 時間」加上從那一刻到這一畫面的經過時間，已包含輸出延遲。
2. 否則：`audible = currentTime − clamp(outputLatency ?? 0) − clamp(baseLatency ?? 0)`，`clamp` 到 `[0, maxLatencyS]`，非有限數視為 0。
3. 結果一律夾在 `[currentTime − maxLatencyS, currentTime]`（喇叭不可能播「未來」的聲音；也擋掉 timestamp 異常）。

瀏覽器端 `readOutputClock(ctx, perfNow)`（`app/composables/audio/context.ts`）負責把這些屬性讀成 `OutputClockSample`，以 `typeof ctx.getOutputTimestamp === 'function'` 等方式特徵偵測。各瀏覽器對 `outputLatency`、`getOutputTimestamp` 的支援度與藍牙時的準確度**待查證**，列入實機矩陣（§11）。

### 5.2 目前亮哪一拍（`app/utils/clock/stepQueue.ts`，純函式）

不用 `stepAtTime(t)` 從錨點反推，因為改速度、跳拍後錨點會換，反推要保留歷史錨點。改用「已排程步的佇列」（排程時 push，視覺時 pop）：

```ts
export interface QueuedStep { step: number; time: number; beatInBar: number }
export interface StepQueue {
  push(e: QueuedStep): void
  /** 丟掉 time <= audible 的所有項目，回傳其中最後一個（目前可聽的拍）；沒有新項目時回傳 undefined */
  advance(audibleTime: number): QueuedStep | undefined
  clear(): void
  readonly size: number
}
export function createStepQueue(): StepQueue
```

### 5.3 rAF 迴圈（`useMetronome` 內）

```
frame(perfNow):
  scheduler.tick()                                  // 第二喚醒來源
  audible = estimateAudibleTime(readOutputClock(ctx, perfNow))
  e = queue.advance(audible)
  if (e && e.beatInBar !== currentBeat.value) currentBeat.value = e.beatInBar
  rafId = requestAnimationFrame(frame)
```

- `currentBeat` 只在值改變時寫入（每秒最多 3–4 次反應式更新，不是 60 次）。
- 兩拍之間燈維持亮著（4 顆圓點中目前那一顆實心），不是只閃一下；這樣 rAF 偶爾掉幀也不會「漏燈」。拍到時再加一個短的放大／亮度動畫（120 ms CSS transition）作為「拍點」。
- 第一拍真正被聽到之前 `currentBeat = null`（四顆都空心）。
- 低耗電模式下 iOS 的 rAF 可能限制在 30 fps，視覺誤差最多約 33 ms，可接受。

### 5.4 `prefers-reduced-motion`

在 `MetronomeBeatIndicator.vue` 的 CSS 處理，不需要 JS：

```css
@media (prefers-reduced-motion: reduce) {
  .dot { transition: none; animation: none; transform: none; }
}
```

- 仍然切換「哪一顆實心」（這是資訊，不是動態效果），只移除放大、脈動、轉場。
- 不做全畫面閃爍（不論是否 reduce，避免光敏風險）。
- 圓點 `aria-hidden="true"`，不在每拍朗讀；另外顯示「第 N 拍」數字僅供視覺（`aria-hidden`），螢幕閱讀器使用者以聲音跟拍。

---

## 6. AudioContext 擁有權

### 6.1 選項比較

| 面向 | A. 每個功能頁各自擁有（採用） | B. App 層級共用一個 context |
|------|------|------|
| iOS 多個 context 限制 | 調音器與節拍器在不同頁面、各自在手勢內才建立、離開時 `close()`，同一時間最多 1 個 | 永遠只有 1 個 |
| iOS 音訊 session | 調音器開麥克風會讓 iOS 進入錄音＋播放模式（輸出可能改走聽筒、變小聲，PRD §9 風險）；調音器 `close()` 並停止 track 後，節拍器新建的 context 是乾淨的純播放 | 共用 context 曾連過麥克風，iOS 的路由狀態可能殘留到節拍器（實際行為待查證）；要靠參照計數與額外重置 |
| 手勢內 resume | 每次開始都在點擊中 `new` + `resume()`，規則單純 | 仍須在手勢內 resume（被系統暫停後），規則一樣；只省掉建立成本（數 ms） |
| 釋放 | 一條 `teardown()` 路徑（與 ADR-005 一致），測試一次涵蓋 | 需參照計數：誰最後一個離開誰 suspend／close；漏減計數就一直佔用音訊硬體、耗電 |
| 頁面切換順序 | 舊頁 `onBeforeUnmount` close，新頁在使用者點擊時才建立；不會交錯 | 需定義跨頁擁有者（plugin），頁面元件的生命週期與 context 生命週期脫鉤 |
| 調音器現況 | 不需改 `useTuner`（ADR-005 維持） | 要重構已驗收的 `useTuner` |
| 未來編曲器（階段 4 同頁有回放＋吉他逐音輸入） | 「每頁一個擁有者」仍成立：編曲器頁的 composable 擁有 context，把它注入 scheduler、voicePool 與 `connectMicrophone` | 天然支援，但同頁共用用 A 也做得到 |

### 6.2 決定

**採用 A**：AudioContext 的擁有者是**頁面層級的功能 composable**（`useTuner`、`useMetronome`，未來 `useArrangerPlayback`），每頁同時只有一個擁有者；底層模組（`scheduler`、`voicePool`、`clickVoice`、`audioGraph`）一律**注入 `ctx`**，自己不建立、不關閉 context。

細節：
- `getAudioContextCtor()` 從 `app/composables/tuner/audioGraph.ts` 移到 `app/composables/audio/context.ts`，`audioGraph.ts` 改為 re-export，調音器程式與測試不需改動。
- 從練習頁導到調音器：`practice.vue` 卸載 → `useMetronome` 的 `onBeforeUnmount` → `teardown()`（`ctx.close()`）。調音器頁要等使用者點「開始調音」或參考音才建立 context，所以兩者不會同時存在。即使 Nuxt 先執行新頁 `setup` 再卸載舊頁，新頁 `setup` 也不建立 context（ADR-005 已規定）。
- 從調音器導到練習頁：反之亦然，調音器在卸載時已 `track.stop()` + `close()`。
- **禁止**對這兩個頁面使用 `<KeepAlive>`／`keepalive: true`。若日後需要，必須在 `onDeactivated` 也呼叫 `teardown()`（加入 code review 檢查項）。
- `useMetronome` 不對外暴露 `AudioContext`。

---

## 7. 檔案與公開 API

### 7.1 檔案清單

| 檔案 | 新增／修改 | 層 | 編曲器重用 | 測試 |
|------|-----------|----|-----------|------|
| `app/utils/clock/params.ts` | 新增 | 純 | ★ | — |
| `app/utils/clock/tempo.ts` | 新增 | 純 | ★ | U |
| `app/utils/clock/timeline.ts` | 新增 | 純 | ★ | U（時間序列） |
| `app/utils/clock/audibleTime.ts` | 新增 | 純 | ★ | U |
| `app/utils/clock/stepQueue.ts` | 新增 | 純 | ★ | U |
| `app/utils/metronome/params.ts` | 新增 | 純 | — | — |
| `app/utils/metronome/beats.ts` | 新增 | 純 | — | U |
| `app/utils/metronome/clickPlan.ts` | 新增 | 純 | — | U |
| `app/composables/audio/context.ts` | 新增 | 轉接（無 Vue） | ★ | C |
| `app/composables/audio/scheduler.ts` | 新增 | 轉接（無 Vue） | ★ | C |
| `app/composables/audio/voicePool.ts` | 新增 | 轉接（無 Vue） | ★ | C |
| `app/composables/metronome/clickVoice.ts` | 新增 | 轉接（無 Vue） | — | C |
| `app/composables/screen/wakeLock.ts` | 新增（D-M2，§12.2） | 轉接（無 Vue） | ★ | C |
| `app/composables/useMetronome.ts` | 新增 | 轉接（Vue） | 參考寫法 | C |
| `app/composables/tuner/audioGraph.ts` | 修改：`getAudioContextCtor` 改為從 `audio/context.ts` re-export | 轉接 | — | 既有 C |
| `app/data/audio-copy.ts` | 新增：`silentModeHint`（文字同 TUN-94） | 資料 | ★ | — |
| `app/data/tuner-copy.ts` | 修改：`referenceHint` 改引用 `audio-copy.ts`（文字不變） | 資料 | — | 既有 C |
| `app/data/metronome-copy.ts` | 新增：節拍器文案 | 資料 | — | C |
| `app/components/metronome/MetronomePanel.vue` | 新增 | 呈現（容器） | — | C |
| `app/components/metronome/MetronomeBpmControl.vue` | 新增 | 呈現 | — | C |
| `app/components/metronome/MetronomeBeatIndicator.vue` | 新增 | 呈現 | — | C |
| `app/pages/practice.vue` | 修改：擁有 `useMetronome()`、放面板、各關按鈕 | 呈現 | — | M |
| `tests/purity.spec.ts`（由 `tests/tuner/purity.spec.ts` 擴充或新增） | 修改 | 測試 | — | — |
| `tests/helpers/fakeAudio.ts` | 修改（§9.2） | 測試 | ★ | — |

U = Node 單元測試、C = happy-dom 元件／composable 測試、M = 手動／實機。

### 7.2 公開 API

#### `app/utils/clock/tempo.ts`

```ts
export const BPM_MIN = 30
export const BPM_MAX = 200
/** 四捨五入成整數並夾在 [BPM_MIN, BPM_MAX]；非有限數回傳 fallback */
export function clampBpm(bpm: number, fallback?: number): number
export function secondsPerStep(bpm: number, stepsPerBeat: number): number   // 60 / bpm / stepsPerBeat
```

#### `app/utils/clock/timeline.ts`

```ts
export interface TempoAnchor { step: number; time: number; bpm: number }
export interface ScheduledStep { step: number; time: number }
export interface Timeline {
  readonly anchor: TempoAnchor
  readonly stepsPerBeat: number
  readonly nextStep: number                     // 下一個要交出的步
  readonly lastScheduled: ScheduledStep | null
}
export function createTimeline(opts: { startTime: number; bpm: number; stepsPerBeat?: number }): Timeline
export function stepTime(tl: Timeline, step: number): number
export interface PlanResult { timeline: Timeline; due: ScheduledStep[]; skipped: number }
export function planWindow(tl: Timeline, now: number, opts?: { lookaheadS?: number; lateToleranceS?: number }): PlanResult
export function changeTempo(tl: Timeline, bpm: number, now: number, opts?: { minLeadS?: number }): Timeline
```

全部為不可變更新（回傳新物件），方便時間序列測試比對。

#### `app/utils/clock/audibleTime.ts`、`stepQueue.ts`

見 §5.1、§5.2。

#### `app/utils/metronome/params.ts`、`beats.ts`、`clickPlan.ts`

```ts
// params.ts
export const BEATS_PER_BAR = 4
export const BPM_STEPS = { fine: 1, coarse: 5 } as const
export const DEFAULT_BPM = 60
export const CLICK = { accent: { … }, normal: { … } } as const   // §4.2 表格

// beats.ts
export function beatOf(step: number, beatsPerBar?: number): { beatInBar: number; accent: boolean }  // step 0 → { 0, true }

// clickPlan.ts
export function clickPlan(accent: boolean): ClickPlan
```

#### `app/composables/audio/context.ts`

```ts
export function getAudioContextCtor(): typeof AudioContext | undefined     // 從 audioGraph 移入
export function readOutputClock(ctx: AudioContext, perfNow: number): OutputClockSample
```

#### `app/composables/audio/scheduler.ts`

```ts
export interface SchedulerOptions {
  ctx: Pick<BaseAudioContext, 'currentTime' | 'state'>
  bpm: number
  stepsPerBeat?: number                            // 節拍器 1；編曲器 2
  onStep(step: number, time: number): void         // 在這裡建立節點並 start(time)
  lookaheadS?: number; wakeIntervalMs?: number; startDelayS?: number
  timers?: { setInterval: typeof setInterval; clearInterval: typeof clearInterval }
}
export interface Scheduler {
  start(): void
  stop(): void
  tick(): void
  setBpm(bpm: number): void
  readonly bpm: number
  readonly running: boolean
  readonly stats: Readonly<{ skippedSteps: number; maxWakeGapMs: number }>
}
export function createScheduler(opts: SchedulerOptions): Scheduler
```

#### `app/composables/audio/voicePool.ts`

```ts
export interface VoicePool {
  add(source: AudioScheduledSourceNode, nodes: AudioNode[]): void
  silenceAll(at: number): void
  readonly size: number
}
export function createVoicePool(): VoicePool
```

#### `app/composables/metronome/clickVoice.ts`

```ts
export function scheduleClick(ctx: BaseAudioContext, out: AudioNode, plan: ClickPlan, time: number):
  { source: OscillatorNode; nodes: AudioNode[] }
```

#### `app/composables/useMetronome.ts`

```ts
export type MetronomePhase =
  | { kind: 'checking' }                                   // SSR 與 onMounted 之前
  | { kind: 'idle' }
  | { kind: 'starting' }                                   // 已在手勢內建立 context，等 resume
  | { kind: 'running' }
  | { kind: 'paused'; reason: 'hidden' | 'interrupted' }   // 切背景、來電、resume 失敗
  | { kind: 'unsupported' }                                // 沒有 AudioContext

export interface UseMetronome {
  phase: Readonly<Ref<MetronomePhase>>
  available: Readonly<ComputedRef<boolean>>     // phase 不是 checking / unsupported
  isPlaying: Readonly<ComputedRef<boolean>>     // starting | running
  bpm: Readonly<Ref<number>>
  currentBeat: Readonly<Ref<number | null>>     // 0..3；未播放或第一拍尚未被聽到時 null
  readonly beatsPerBar: 4
  /** 必須在 click handler 中「同步」呼叫；內部先同步 new AudioContext() + resume()，之後才 await */
  start(): Promise<void>
  stop(): void
  toggle(): Promise<void> | void
  /** clampBpm；播放中依 §3.5 下一拍生效 */
  setBpm(bpm: number): void
  nudgeBpm(delta: number): void                 // ±1 / ±5
  /** 「用 N BPM 練習」：setBpm(n)；未播放則 start()；播放中只換速度，不重建 context。必須在 click 中呼叫 */
  playAt(bpm: number): Promise<void> | void
}
export function useMetronome(opts?: { initialBpm?: number }): UseMetronome
```

只在 `setup` 中呼叫；`setup` 只建立 ref，所有瀏覽器存取在 `onMounted` 或使用者事件內。

`start()` 流程（與 `useTuner` §6.2 同型）：

```ts
function start() {
  if (isPlaying.value) return Promise.resolve()          // 連點保護
  const token = ++startToken
  phase.value = { kind: 'starting' }
  const ctx = (audioCtx = new (getAudioContextCtor()!)())   // 手勢內同步
  const resumeP = ctx.resume()                               // 手勢內同步
  return finishStart(token, ctx, resumeP)
}
async function finishStart(token, ctx, resumeP) {
  await resumeP.catch(() => {})
  if (token !== startToken) return                       // 期間已 stop / 離開
  if (ctx.state !== 'running') { teardown(); phase.value = { kind: 'paused', reason: 'interrupted' }; return }
  master = ctx.createGain(); master.connect(ctx.destination)
  pool = createVoicePool(); queue = createStepQueue()
  scheduler = createScheduler({ ctx, bpm: bpm.value, onStep })
  ctx.onstatechange = () => { if (ctx.state !== 'running' && phase.value.kind === 'running') { teardown(); phase.value = { kind: 'paused', reason: 'interrupted' } } }
  scheduler.start(); rafId = requestAnimationFrame(frame)
  phase.value = { kind: 'running' }
}
```

`stop()`：`++startToken`、`teardown()`、`phase = idle`。

觸發 `teardown()` 的事件（同 ADR-005）：

| 事件 | 動作 |
|------|------|
| 使用者按停止 | `teardown()` → `idle` |
| `onBeforeUnmount`（離開練習頁） | `teardown()`，移除 document／window 監聽 |
| `visibilitychange` → `hidden`（僅 starting／running 時） | `teardown()` → `paused('hidden')` |
| `pagehide` | `teardown()` |
| `ctx.onstatechange` 變成非 running（iOS 來電、`interrupted`） | `teardown()` → `paused('interrupted')` |
| 回到前景 | **不自動重啟**；面板顯示「節拍器已暫停，點一下繼續」，點擊 → `start()` |

### 7.3 給編曲器的重用方式（說明用，非第一版範圍）

```
useArrangerPlayback（擁有 ctx）
  └ createScheduler({ ctx, bpm: song.bpm, stepsPerBeat: 2, onStep })
       onStep(step, time):  pos = step % totalEighths（循環）或 step >= total 時停止
                            對該八分音符位置的 旋律／和弦／低音 事件 → 各聲部 voice（PeriodicWave，同參考音）
                            pool.add(...)；queue.push(...)（游標顯示）
  └ estimateAudibleTime + stepQueue → 播放游標
```

重用：`utils/clock/*`、`audio/context.ts`、`audio/scheduler.ts`、`audio/voicePool.ts`、`fakeAudio` 擴充。不重用：`utils/metronome/*`、`clickVoice.ts`、`useMetronome.ts`（只當寫法範本）。若日後編曲器需要「從第 N 小節開始」，在 `createTimeline` 加 `startStep` 參數即可，不影響節拍器。

---

## 8. UI 放置

### 8.1 建議：單一共用面板，行動裝置常駐底部

| 選項 | 評估 |
|------|------|
| **單一共用面板，底部常駐（採用）** | 一個 `useMetronome` 實例、一個 context；捲動到任何一關都能停止或調速；各關按鈕只負責「帶入 BPM 並開始」 |
| 每關各自一個節拍器 | 6 份重複 UI；多實例要互斥（否則同時兩組 click）；捲走後找不到停止鍵 |
| 頁首一個面板（不常駐） | 捲到第 5 關時要捲回頂端才能停；練習時手在琴上，來回捲動很不方便 |

### 8.2 版面

- `practice.vue` 擁有 `const metronome = useMetronome({ initialBpm })`，`initialBpm` = 目前關卡的 `targetBpm`（`loaded` 之前用 `DEFAULT_BPM` 60；`loaded` 後若尚未播放則 `setBpm(目前關卡 targetBpm)`）。以 prop 傳給 `<MetronomePanel :metronome="metronome" />`（不用 provide/inject，依賴較明確）。
- 面板放在 `<ol class="stages">` 之後，`position: sticky; bottom: 0`，`padding-bottom: max(8px, env(safe-area-inset-bottom))`，背景 `var(--surface)` + 上框線；寬度跟內容欄一致（`max-width: 960px`）。桌面與手機同一個元件，不另做側欄。
  - `env(safe-area-inset-bottom)` 需要 viewport meta 有 `viewport-fit=cover` 才有值；目前 `nuxt.config.ts` 未設定，實作時一併加上並檢查其他頁面不受影響。
- **精簡列**（高度約 64 px，單列）：`[−5] [−1]  60 BPM  [+1] [+5]   ● ○ ○ ○   [▶ 開始]`。窄於 360 px 時換成兩列（BPM 控制一列、圓點＋播放一列）。所有按鈕 ≥ 44×44 px（同 TUN-46）。
- 靜音提示（`silentModeHint`，與 TUN-94 同文案）以小字放在面板內播放鍵下方，始終顯示（和調音器一致，不偵測 UA）。
- `paused` 時播放鍵文字改為「節拍器已暫停，點一下繼續」。`unsupported` 時面板顯示「這個瀏覽器不支援節拍器」，各關按鈕 disabled。
- SSR：`MetronomePanel` 包在 `<ClientOnly>`，fallback 是同高度的骨架（避免版面跳動）；各關按鈕在 SSR 就輸出，`:disabled="!metronome.available.value"`（server 與首次 hydration 都是 `checking` → disabled，一致不會 mismatch）。
- 頁面底部加 `padding-bottom` 等於面板高度，最後一關的按鈕不會被蓋住。

### 8.3 各關按鈕

- 位置：每關卡片「目標 N BPM・每天 M 分鐘」那一行下方，與「我過關了」同一個 `.actions` 列，次要樣式：`▶ 用 60 BPM 練習`。
- 點擊（手勢內）：`metronome.playAt(stage.targetBpm)`。
  - 未播放：設定 BPM 並開始。
  - 播放中：只換速度（下一拍生效），不重新開始。
- `data-testid="metronome-stage-${stage.id}"`。
- 頁面記一個 `metronomeStageId` ref；面板標題顯示「第 3 關目標速度」；使用者用 ±鍵手動調整時清除（面板 emit `manual-change`）。這是純顯示，不影響過關判定。

### 8.4 BPM 範圍與步進

- 範圍 **30–200**，整數。`clampBpm` 在 composable 與純函式兩邊都套用。練習關卡 50–70、編曲器 50–140 都在範圍內。
- 按鈕 **−5／−1／+1／+5**；到邊界時對應按鈕 disabled。
- 第一版不做長按連續加減、不做數字直接輸入（保持簡單；若 Beta 回饋需要再加）。
- BPM 數字 `aria-live="polite"`（只在 BPM 改變時朗讀，不在每拍朗讀）；播放鍵 `aria-pressed`；±鍵 `aria-label="減少 5 BPM"` 等。

---

## 9. 測試策略

### 9.1 工具

沿用調音器設定（ADR-006）：Node 環境跑 U；`// @vitest-environment happy-dom` 跑 C。計時器用 `vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })`——**明確列出**，不要用預設（預設也會假造 `requestAnimationFrame`，和 `installFakeAudio` 自己的 rAF 替身衝突）。

時間序列測試的寫法：自己推進 `now`（純函式）或 `FakeAudioContext.advance(dt)`（C 測試），不依賴真實時間。用 `tests/helpers/prng.ts` 的固定種子產生喚醒抖動。

### 9.2 `tests/helpers/fakeAudio.ts` 擴充

| 擴充 | 內容 |
|------|------|
| `FakeParam` | 增加 `exponentialRampToValueAtTime`、`setTargetAtTime` 的 `vi.fn()`。**不加** `cancelAndHoldAtTime`：調音器的「沒有 `cancelAndHoldAtTime` 時退回 `cancelScheduledValues`」測試依賴它不存在；需要它的測試自行指定 |
| `FakeOscillator` | `type` 欄位；`get startAt(): number \| undefined`（`start` 第一次呼叫的參數）、`get stopAt()`（最後一次 `stop` 的參數）；`ended` 狀態 |
| `FakeGain` 類別 | 取代目前 `createGain` 的物件字面值：`gain: FakeParam`、`connect`／`disconnect` spy，記錄在 `ctx.gains` |
| `FakeAudioContext` | `outputLatency`、`baseLatency`（可設定，預設 `undefined`）；可選 `getOutputTimestamp`（測試設定回傳值）；`advance(dt)`：`currentTime += dt`，並對 `stopAt <= currentTime` 的 oscillator 呼叫 `end()`（模擬 `onended`） |
| 查詢輔助 | `startTimes(ctx)`：所有 oscillator 的 `startAt` 依序；`liveOscillators(ctx)`：尚未 `end()` 的 |

既有調音器測試只用到 `createGain` 的 `gain`／`connect`／`disconnect`，改成 `FakeGain` 不影響。

### 9.3 純函式測試案例（U）

`tests/clock/tempo.spec.ts`
- `clampBpm`：25→30、250→200、60.4→60、60.5→61、`NaN`→fallback、`Infinity`→fallback。
- `secondsPerStep(60,1)=1`、`(120,2)=0.25`、`(200,1)=0.3`。

`tests/clock/timeline.spec.ts`
1. **不漂移（60 BPM、1 小時）**：`startTime=1`，`now` 從 0 每 25 ms 推進到 3601 s，每次 `planWindow`；收集的步為 0..3600 連續、無重複，每一步 `|time − (1 + n)| < 1e-9`。
2. **不漂移（200 BPM、2 小時、抖動喚醒）**：喚醒間隔 = 25 ms + 固定種子 0–60 ms 抖動；所有步 `|time − (start + n × 0.3)| < 1e-9`，`skipped = 0`。
3. **視窗邊界**：`now = stepTime(n) − 0.1` 時第 n 步**不**在 due（`<` horizon 是嚴格不等式）；`now` 再加 1e-6 就在。
4. **同一步只交出一次**：重疊視窗（同一 `now` 呼叫兩次）第二次 `due = []`。
5. **改速度（60→120）在拍間**：步 0..3 已排（`lastScheduled.step = 3`、time 4.0），`now = 3.95` 時 `changeTempo(…,120)` → 步 4 time = 4.5，步 5 = 5.0；步 3 不變。
6. **改速度在第一拍之前**：`lastScheduled = null` 時改 bpm，第一拍時間不變，之後間隔為新速度。
7. **慢改快觸發 `MIN_LEAD_S`**：30 BPM，上一拍在 `now − 1.5`，改 200 → 下一拍 = `now + 0.02`，之後 0.3 s 間隔。
8. **連續改速 10 次後仍無累積誤差**：每段內的步時間都等於該段錨點公式值（< 1e-9）。
9. **計時器延遲 1.3 s（120 BPM）**：`skipped = 2`（依實際格線計算），下一個 due 的時間在原格線上（`(time − start) / 0.5` 為整數，誤差 < 1e-9），且 `>= now − 0.01`。
10. **延遲在容忍內**：步時間 = `now − 0.005` 仍在 due（晚 5 ms 照播）；`now − 0.02` 被跳過。
11. **長時間暫停 O(1)**：`now` 跳到 1e6 s，`planWindow` 回傳正確 `skipped` 且執行時間 < 1 ms（不逐拍迴圈）。
12. **stepsPerBeat = 2**：120 BPM 下步間隔 0.25 s（編曲器八分音符）。

`tests/clock/audibleTime.spec.ts`
- timestamp 有效：`contextTime=10, performanceTime=5000, perfNow=5020` → 10.02（並夾在 ≤ currentTime）。
- timestamp 全 0（Chrome 起播前）→ 走 fallback。
- fallback：`currentTime=10, outputLatency=0.1, baseLatency=0.01` → 9.89。
- `outputLatency` undefined／NaN → 視為 0。
- `outputLatency = 3` → 夾到 0.5。
- 結果不大於 `currentTime`、不小於 `currentTime − 0.5`。

`tests/clock/stepQueue.spec.ts`
- 空佇列 `advance` → undefined。
- push 步 0..3（time 1,2,3,4）；`advance(0.99)` → undefined；`advance(1.0)` → 步 0；`advance(3.5)` → 步 2，且步 0–2 已移除（size = 1）。
- `clear()` 後 size = 0。

`tests/metronome/beats.spec.ts`、`clickPlan.spec.ts`
- `beatOf(0)` = `{0, true}`、`beatOf(3)` = `{3, false}`、`beatOf(4)` = `{0, true}`、`beatOf(4001)` = `{1, false}`。
- 重音的 `frequency` 與 `peakGain` 都大於一般拍；`attackS < durationS`；`durationS ≤ 0.1`（最快 200 BPM 一拍 0.3 s，不重疊）。

`tests/purity.spec.ts`（擴充）
- 掃描目錄改為 `[tuner, clock, metronome]`，套用既有規則。
- `clock/`、`metronome/` 額外禁止 `setTimeout|setInterval|requestAnimationFrame`。
- **PA-08**：`app/` 內只有 `app/composables/audio/scheduler.ts` 出現 `setInterval`；該檔不出現 `createOscillator|createBufferSource|\.start\(`。
- `app/composables/audio/**` 不 import `vue`、不 import `metronome/`、`tuner/`。

### 9.4 轉接層測試案例（C，happy-dom + fakeAudio）

`tests/components/scheduler.spec.ts`
1. `start()` 立即排第一拍：`onStep(0, currentTime + 0.1)`。
2. 每次 interval（25 ms）＋ `ctx.advance(0.025)`，60 BPM 跑 30 秒：`onStep` 的 time 序列間隔皆為 1.000（< 1e-9），無重複步。
3. 計時器延遲：`ctx.advance(2)` 但不觸發 interval，再觸發一次 → 沒有任何 `time < currentTime − 0.01` 的 onStep；`stats.skippedSteps` 增加；`stats.maxWakeGapMs ≥ 2000`。
4. `tick()` 額外呼叫（模擬 rAF）不會重複排程。
5. `setBpm` 在播放中：下一個未排的步間隔 = 新速度。
6. `stop()` 清除 interval（`vi.getTimerCount() === 0`），之後 `tick()` 不呼叫 onStep。
7. `ctx.state = 'suspended'` 時 `tick()` 不排程。
8. `onStep` 丟例外：時鐘繼續、後續步仍被呼叫。

`tests/components/voicePool.spec.ts`
- `add` 後 size + 1；oscillator `end()` → 所有節點 `disconnect` 被呼叫、size − 1。
- `silenceAll(t)`：每個 source `stop(t)`、全部 disconnect、size = 0；之後 `end()` 不會丟例外。

`tests/components/useMetronome.spec.ts`（以小型測試元件掛載 composable）
1. 掛載後 `phase` 由 `checking` → `idle`；**未建立** AudioContext。
2. 沒有 AudioContext → `unsupported`、`available = false`。
3. **手勢規則**：在模擬 click 中呼叫 `start()`，同步檢查（await 之前）已 `new` 一個 context 且 `resume` 已被呼叫一次。
4. resume 後：第一個 oscillator `startAt = currentTime + 0.1`、`frequency = 1500`（重音）；第 2–4 個為 1000；第 5 個又是 1500。
5. **時間序列**：60 BPM 推進 60 秒（每 25 ms `advance` + 觸發 interval），oscillator 的 `startAt` 間隔全部 = 1.0（< 1e-9）；每個 oscillator 都有 `stopAt = startAt + duration + 0.005`。
6. **節點回收**：同上 5 分鐘，`liveOscillators().length ≤ 3`，已結束的 oscillator 與 gain 都 `disconnect`。
7. **改 BPM**：播放中 `setBpm(120)`，已建立的 oscillator `startAt` 不變；下一個新 oscillator 與前一個間隔 0.5。
8. **計時器延遲**：`ctx.advance(1.5)` 不觸發 interval → 下一次喚醒後沒有 `startAt < currentTime − 0.01` 的新 oscillator。
9. `setBpm(25)` → 30；`nudgeBpm(+5)` 在 198 → 200；idle 時改 BPM 不建立 context。
10. `playAt(70)`：idle → 開始且 `bpm = 70`；running 時再 `playAt(50)` → 不建立第二個 context、`bpm = 50`。
11. **連點**：同步呼叫 `start()` 兩次 → 只有 1 個 context。
12. **競態**：`start()` 後、resume resolve 前呼叫 `stop()` → resume 之後不排任何 oscillator、context 已 close、`phase = idle`。
13. **resume 失敗**（`FakeAudioContext.resumeTo = 'suspended'`）→ `paused('interrupted')`、context close。
14. **stop**：所有 live oscillator 的 `stopAt ≤ currentTime`；master gain `disconnect`；`cancelAnimationFrame` 被呼叫；`ctx.close` 被呼叫；`currentBeat = null`；`vi.getTimerCount() === 0`。
15. 停止後再 `start()` → 建立**新** context（舊的已 closed）。
16. **visibility hidden** → teardown、`paused('hidden')`；改回 visible → 不建立 context、不排程。
17. **pagehide** → teardown。
18. **卸載** → teardown、移除 document／window 監聽、無殘留計時器。
19. **ctx 被中斷**：`ctx.setState('interrupted')` → `paused('interrupted')`。
20. **視覺對時（fallback）**：`outputLatency = 0.1`；第 1 拍 `startAt = T`；`currentTime = T + 0.05` 時 `raf.tick` → `currentBeat = null`；`currentTime = T + 0.11` → `currentBeat = 0`。
21. **視覺對時（getOutputTimestamp）**：設定 timestamp 使可聽時間 = T − 0.001 → 仍為前一拍；= T + 0.001 → 新拍。
22. `currentBeat` 在兩拍之間的多次 `raf.tick` 不重複寫入（以 `watch` 計數觸發次數 = 拍數）。

`tests/components/MetronomePanel.spec.ts`
- 顯示 BPM；±1／±5 呼叫 `nudgeBpm`；到 30／200 時對應按鈕 disabled。
- 播放鍵切換 `aria-pressed`、文字；`paused` 時顯示「點一下繼續」。
- 靜音提示文字等於 `silentModeHint`（與 `tunerCopy.referenceHint` 相同）。
- 4 顆圓點，`currentBeat = 2` 時第 3 顆有 `is-active`、第 1 顆有 `is-accent`；圓點容器 `aria-hidden="true"`。
- `unsupported` 時顯示不支援文案。

`practice.vue` 使用 auto-import（`computed`、`useSeoMeta`），無法在現有 Vitest 設定下掛載，按鈕串接以 M 測試（手動清單：每關按鈕 → 面板 BPM 正確並開始；播放中按另一關 → 只換速度）。若要自動化，把「各關按鈕」抽成 `StageMetronomeButton.vue`（明確 import）再做 C 測試——可選。

---

## 10. 架構決策紀錄（ADR）

### ADR-008：播放時鐘採「純函式時間軸（錨點＋整數步）＋ lookahead 排程器（25 ms 喚醒、100 ms 視窗）」，跳拍不補拍

**Status**: Proposed

**背景**
PA-08 要求節拍器以可重用的播放時鐘實作，不得用 `setInterval` 直接發聲；同一時鐘要支撐階段 1 節奏教學與階段 3 起的編曲器回放（八分音符網格、三聲部）。R-06 指出手機計時漂移、背景暫停的風險。調音器已建立「純邏輯在 `app/utils/`、可在 Node 以時間序列測試」的慣例（ADR-003/004）。

**決策**
- 時間軸是純函式：`錨點 { step, time, bpm }` + 整數步號，步時間以公式計算；`planWindow` 交出 `[now − 10 ms, now + 100 ms)` 內未排程的步；過期步以 O(1) 跳過並計數；`changeTempo` 讓下一個未排程步以新速度間隔生效（並不早於 `now + 20 ms`）。
- 瀏覽器 scheduler 以 `setInterval(25 ms)` 與 rAF 兩個來源呼叫冪等的 `tick()`，只負責把步交給 `onStep(step, time)`，發聲由 consumer 用 `start(time)` 完成。
- 放在 `app/utils/clock/`（純）與 `app/composables/audio/scheduler.ts`（轉接），不依賴節拍器。

**後果**
- 容易：漂移、改速、延遲都能在 Node 以確定性時間序列測試；編曲器只需換 `stepsPerBeat` 與 `onStep`；PA-08 可用靜態掃描檢查。
- 困難：改速度最多延後一個已排程的拍（≤ 100 ms）；計時器長時間被凍結時會漏拍（以計數暴露，靠實機測試）；多一層 step／time 的概念需要文件說明。

**替代方案**
- **`setInterval` 每拍直接發聲**：PRD 明令禁止；手機上抖動數十毫秒。
- **一次把未來數十秒的拍子全部排進去**：最穩，但改速度、停止都要取消大量節點，記憶體隨時長成長，且編曲器編輯中即時改內容會很難。
- **AudioWorklet 內計時**：取樣精準且不受主執行緒影響，但要另外的 worklet 檔與訊息通道、SSR／打包設定、測試難度高；lookahead 已能達到取樣精準的發聲時間，不值得。
- **Web Worker 計時器**：可避免主執行緒節流，但第一版切背景即停止；列為實機發現問題時的備案（§11）。
- **補拍或重新對齊格線**：見 §3.4，聽感與編曲器同步都較差。

### ADR-009：AudioContext 由各功能頁的 composable 各自擁有與釋放，不做 app 層級共用

**Status**: Proposed

**背景**
調音器（`/tuner`）與節拍器（`/practice`）是不同頁面。iOS 對同時存在的 context 數量、手勢內 resume、以及開過麥克風後的音訊路由都有限制；ADR-005 已規定調音器是單一擁有者、離開即 `close()`。未來編曲器在同一頁同時需要回放與吉他逐音輸入。

**決策**
- 每頁一個擁有者：`useTuner`、`useMetronome`（未來 `useArrangerPlayback`）在使用者手勢內 `new AudioContext()` + `resume()`，在停止、切背景、`pagehide`、卸載、context 被中斷時 `close()`。
- 底層模組（scheduler、voicePool、clickVoice、audioGraph）一律注入 `ctx`，不建立、不關閉。
- `getAudioContextCtor` 移到 `app/composables/audio/context.ts` 共用。
- 這兩個頁面禁用 `<KeepAlive>`；若日後啟用，`onDeactivated` 也要 teardown。

**後果**
- 容易：釋放路徑單一、可測；調音器不需重構；練習頁與調音器之間切換時，同一時間最多一個 context；節拍器不會繼承調音器的錄音模式路由。
- 困難：每次開始都新建 context（數 ms 成本）；節拍器不能跨頁面持續播放（第一版也不需要，§12）。

**替代方案**
- **App 層級單一 context（Nuxt plugin／module 層 singleton）**：省建立成本、天然支援跨頁，但需要參照計數決定何時 suspend／close，漏一次就持續佔用音訊硬體；開過麥克風的 context 可能讓 iOS 輸出路由殘留；還要改已驗收的 `useTuner`。
- **停止時 `suspend()` 保留 context，只在離開頁面 close**：重新開始略快，但多一個狀態與一條釋放路徑；第一版不需要。

### ADR-010：Click 以每拍一組 OscillatorNode + GainNode 合成，重音用較高音高與較大音量

**Status**: Proposed

**背景**
節拍聲要短、清楚、在手機喇叭上聽得到，並能和吉他聲區分；調音器參考音已用 Oscillator + Gain 包絡；編曲器將用合成音色回放。

**決策**
每拍建立 `OscillatorNode(triangle) + GainNode`（1 ms 線性起音、40–50 ms 指數衰減），重音 1500 Hz／0.8、一般拍 1000 Hz／0.45；全部接到每次播放建立的 master gain；`voicePool` 追蹤未結束的節點，`onended` 時斷開，停止時 `silenceAll` + 斷開 master。參數在 `app/utils/metronome/params.ts`。

**後果**
- 容易：無預先產生資料；與既有 fakeAudio 相容；參數好調。
- 困難：每拍建立兩個節點（可忽略）；音色較「電子」，不像木魚。

**替代方案**
- **預先產生 AudioBuffer**：音色可更自然，但要依 `sampleRate` 產生、多一種 fake；需要時再換，不影響時鐘。
- **單一常駐 oscillator，用 gain 自動化開關**：節點最少，但停止與改速度時要清除大量自動化事件，且音高改變不易。

### ADR-011：視覺以 rAF 讀取「可聽時間」對齊已排程步佇列，優先 `getOutputTimestamp`，否則 `currentTime − outputLatency − baseLatency`

**Status**: Proposed

**背景**
核准範圍要求視覺必須以 `ctx.currentTime` 與 `outputLatency` 對時，不能另跑計時器。`currentTime` 是正在算的音訊時間，喇叭實際播出還要再晚一個輸出延遲（藍牙可達數百毫秒）。改速度與跳拍會換錨點。

**決策**
- 純函式 `estimateAudibleTime`：timestamp 有效時 `contextTime + (perfNow − performanceTime)/1000`；否則 `currentTime − outputLatency − baseLatency`（夾 0–0.5 s）；結果不超過 `currentTime`。
- 排程時把 `{ step, time, beatInBar }` push 進 `stepQueue`；rAF 每畫面 `advance(audible)` 取得目前可聽的拍。
- 圓點在兩拍間保持亮，`prefers-reduced-motion` 只移除動畫，不移除拍位資訊。

**後果**
- 容易：視覺與聲音共用同一時間來源；改速、跳拍不用回推；純函式可測各種瀏覽器回報值。
- 困難：瀏覽器若回報錯誤或不回報藍牙延遲，視覺會早於聲音（不影響聲音本身）；需實機矩陣確認，必要時日後加手動校正。

**替代方案**
- **只用 `currentTime` 不扣延遲**：實作最簡單，但藍牙下視覺會明顯提前。
- **`setTimeout(延遲)` 觸發亮燈**：又是另一個會漂移的計時器，違反核准範圍。
- **從錨點反推 `stepAtTime`**：改速度後需要錨點歷史，較複雜。

### ADR-012：節拍器 UI 為練習頁單一共用面板，常駐底部，由頁面擁有 composable 實例

**Status**: Proposed

**背景**
練習頁有 6 關，每關有 `targetBpm`；使用者練習時雙手在琴上，頁面很長；核准範圍要求每關有「用 N BPM 練習」按鈕與手動加減。

**決策**
`practice.vue` 呼叫一次 `useMetronome()`，以 prop 傳給 `MetronomePanel`；面板 `position: sticky; bottom: 0`，精簡單列（窄螢幕兩列）；各關按鈕呼叫 `playAt(targetBpm)`（未播放則開始，播放中只換速度）。BPM 30–200、±1／±5。

播放中以 Screen Wake Lock 保持螢幕常亮（D-M2，細節見 §12.2）。

**後果**
- 容易：一個實例、一個 context；任何捲動位置都能停止與調速；各關按鈕邏輯只有一行。
- 困難：底部常駐佔用約 64 px 的可視高度；需處理 safe area 與頁面底部留白。

**替代方案**
- **每關各自一個節拍器**：重複 UI、需要互斥、捲走就找不到停止鍵。
- **頁首面板**：練習中要捲回頂端操作。
- **全站浮動節拍器（跨頁持續）**：與 ADR-009 衝突，且第一版不需要（§12 待決定）。

---

## 11. 風險與待實機驗證

實機矩陣沿用 PRD §5.1.8（iOS Safari、Android Chrome 中階機、桌面 Chrome／Safari）。開發模式下 `/practice?debug=clock` 顯示 `skippedSteps`、`maxWakeGapMs`、`outputLatency`、`baseLatency`、是否有 `getOutputTimestamp`，方便記錄。

| # | 項目 | 風險 | 驗證方法 | 備案 |
|---|------|------|---------|------|
| 1 | **iOS 靜音開關** | 開靜音時網頁音訊無聲，使用者以為壞了 | iOS 開／關靜音各播 30 秒，記錄是否有聲 | 第一版：TUN-94 同文案提示。可評估 `navigator.audioSession.type = 'playback'`（Safari 的 Audio Session API）讓節拍器在靜音模式下仍有聲，但它會中斷其他 App 的音樂，且行為與支援版本待查證 → §12 決定 |
| 2 | **藍牙耳機延遲** | 輸出延遲 150–300 ms；瀏覽器可能不回報或回報不準，視覺提前 | AirPods、一般藍牙耳機各一；以慢動作錄影比對燈與聲音；記錄回報的 `outputLatency` | 聲音本身準確不受影響；若視覺偏差明顯，日後加「延遲校正」滑桿（T2 點擊測驗也需要同一校正） |
| 3 | **低耗電模式的計時器節流** | 計時器或 rAF 被降頻，喚醒間隔 > 75 ms 時漏拍 | iOS 低耗電模式、Android 省電模式各播 10 分鐘，記錄 `skippedSteps`、`maxWakeGapMs` | 依序：(a) `LOOKAHEAD_S` 調到 0.2；(b) 依觀察到的喚醒間隔自動放大視窗（上限 0.3 s）；(c) Web Worker 計時器 |
| 4 | **鎖屏／螢幕自動關閉** | 練琴時手不碰手機，30 秒後螢幕關閉 → `hidden` → 節拍器停止，這可能是最常見的「壞掉」體驗 | 預設自動鎖定設定下播放 2 分鐘 | Screen Wake Lock API（`navigator.wakeLock.request('screen')`）在播放時保持亮螢幕，停止時釋放 → §12 決定 |
| 5 | **長時間漂移** | 理論上無，但要確認裝置音訊時鐘 | 播 10 分鐘，用另一台裝置錄音，量第 1 拍與第 600 拍的間隔 | — |
| 6 | **從調音器切到練習頁後的 iOS 輸出路由** | 開過麥克風後 iOS 可能仍走聽筒或音量偏小 | 先在調音器開麥克風 → 回練習頁開節拍器，比較音量 | ADR-009 已確保新 context；仍有問題則在 M 測試記錄並在提示文案說明 |
| 7 | **iOS 來電／Siri 中斷** | context 變成 `interrupted` | 播放中撥入電話 | 已處理：`paused('interrupted')`，點一下繼續 |
| 8 | **停止時爆音** | 立即 `close()` 切斷正在響的 click | 多次在拍點附近按停止 | §4.4 的淡出後延遲 close |
| 9 | **click 在吉他聲中聽不清** | 1–1.5 kHz 被刷弦掩蔽 | 實際刷和弦時聽 | 調整 `params.ts`（頻率、`peakGain`、波形） |
| 10 | **`getOutputTimestamp`／`outputLatency` 支援度** | 各瀏覽器實作與數值品質不同（待查證） | 實機記錄 debug 面板數值 | fallback 已設計；異常值有夾限 |

---

## 12. 需要產品負責人決定的事

| # | 問題 | 選項 | 建議 |
|---|------|------|------|
| D-M1 | 「用 N BPM 練習」按下後是否**立即開始播放** | (a) 設定 BPM 並開始；(b) 只設定 BPM，使用者再按播放 | **(a)**：按鈕文字就是「練習」，少一次點擊；播放中按另一關只換速度 |
| D-M2 | 播放中是否**保持螢幕常亮**（Screen Wake Lock） | (a) 是；(b) 否（螢幕關閉即停止） | **(a)**：否則預設 30 秒鎖屏就會停，像是壞掉；成本小（約 20 行），停止與切背景時釋放。這是核准範圍外的新增，需確認 |
| D-M3 | iOS 靜音開關 | (a) 只顯示提示（核准範圍）；(b) 另外用 Audio Session API 讓靜音時也有聲（會暫停使用者正在播的音樂） | 第一版 **(a)**，實機測 (b) 的效果後再決定 |
| D-M4 | 節拍器範圍是否只在練習頁 | (a) 只有練習頁；(b) 全站浮動、跨頁持續 | **(a)**；(b) 與調音器的麥克風互斥，且違反 ADR-009，等有需求訊號再談 |
| D-M5 | 是否記住上次的 BPM | (a) 不記，預設目前關卡的 `targetBpm`；(b) 存 localStorage | **(a)**：每次從關卡目標出發較符合教學；不新增儲存 key |
| D-M6 | BPM 範圍 30–200、步進 ±1／±5 | 確認或調整 | 建議採用；涵蓋練習關卡（50–70）與編曲器（50–140） |
| D-M7 | 底部面板是否常駐（未啟用時也顯示） | (a) 常駐精簡列；(b) 按任一關按鈕後才出現 | **(a)**：可發現性較好，占用約 64 px |

### 12.1 產品負責人決定（2026-10-29）

| # | 決定 |
|---|------|
| D-M1 | (a) 按「用 N BPM 練習」立即開始播放；播放中按只換速度（`playAt`） |
| D-M2 | (a) 播放時以 Screen Wake Lock 保持螢幕常亮（新增範圍，見 §12.2） |
| D-M3 | (a) 只顯示提示；沿用 TUN-94 文案，抽到 `app/data/audio-copy.ts`（`silentModeHint`），調音器 `tunerCopy.referenceHint` 改引用它（字句不變）。不使用 Audio Session API |
| D-M4 | (a) 只在練習頁，不做跨頁播放 |
| D-M5 | (a) 不記住上次的 BPM；讀到進度後預設為目前關卡（`useProgress` + `currentStageId`）的 `targetBpm`，全部過關時用最後一關 |
| D-M6 | 採用：30–200 的整數，±1／±5 |
| D-M7 | (a) 底部精簡列常駐，未啟用時也顯示 |

### 12.2 Screen Wake Lock（D-M2，ADR-012 的補充）

- 位置：`app/composables/screen/wakeLock.ts`（瀏覽器轉接，無 Vue，不依賴 metronome／tuner，編曲器回放可重用）。`useMetronome` 是唯一持有者。
- **只在播放中持有**：`finishStart` 進入 `running` 後呼叫 `navigator.wakeLock.request('screen')`；`teardown()`（停止、`visibilitychange:hidden`、`pagehide`、context 中斷、`onBeforeUnmount`）一律 `release()`。§4.4 的第 6 步即為此。
- **回到前景不自動重新取得**：切背景時瀏覽器本來就會自動釋放，而節拍器此時已停止（`paused('hidden')`）；使用者點「繼續」重新 `start()` 時才再取得。
- **不支援或取得失敗時靜默略過**：沒有 `navigator.wakeLock`、`request()` 同步丟例外或 reject（例如 `NotAllowedError`、省電模式）都不顯示錯誤、不影響播放。
- **競態**：`request()` 尚未 resolve 就 `release()`（例如開始後立刻停止）時，以世代計數判斷，resolve 後立即釋放取得的 sentinel，不殘留。系統主動釋放（`release` 事件）時清掉持有狀態，之後的 `release()` 不重複呼叫。
- 測試：`tests/components/useMetronome.spec.ts` 的「Screen Wake Lock (D-M2)」區塊（取得、停止／切背景／卸載釋放、不在前景時重取、晚到的 lock 立即釋放、不支援／失敗靜默）。

---

## 13. 實作順序建議

1. 純函式：`clock/tempo` → `clock/timeline`（含 §9.3 全部時間序列測試）→ `audibleTime` → `stepQueue` → `metronome/*`；擴充 `purity.spec.ts`。
2. `fakeAudio` 擴充；`audio/context`（搬移 `getAudioContextCtor`，跑既有調音器測試確認不受影響）→ `scheduler` → `voicePool` → `clickVoice`。
3. `useMetronome` 與其 C 測試。
4. 元件與 `practice.vue` 串接；`audio-copy.ts` 共用靜音提示；`viewport-fit=cover`。
5. debug 面板與 §11 實機矩陣，回填結果到本文件。
