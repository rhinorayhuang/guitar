# 調音器技術架構（`/tuner`）

**Status**: Proposed（已實作，並依 code review 修訂）  **對應 PRD**: `docs/prd.md` v0.3 §5.1（TUN-xx）、§7  **Last Updated**: 2026-10-28
**讀者**: frontend-developer（實作）、Eng Lead（審查）、PM（§10 有需要 PM 確認的 PRD 落差）

本文件是調音器的**實作藍圖**：選定演算法、執行方式、模組與檔案、公開 API、狀態機、錯誤對應與測試案例。數值型參數一律以 `app/utils/tuner/params.ts` 為準（對應 PRD §5.1.11），本文件出現的數字是初始值。

---

## 0. 結論摘要

| 主題 | 決定 | ADR |
|------|------|-----|
| 音高偵測 | **McLeod Pitch Method（MPM）**：NSDF 以 FFT 計算 + 拋物線內插 + 子八度檢查（octave guard） | ADR-001 |
| 分析視窗 | 2048 samples（44.1/48 kHz），> 48 kHz 時 4096；由 `windowSizeFor(sampleRate)` 計算，不寫死取樣率 | ADR-001 |
| 執行方式 | **主執行緒** `AnalyserNode.getFloatTimeDomainData` + `requestAnimationFrame` 輪詢（約 60 次/秒）；**不用** AudioWorklet、**不用** Web Worker | ADR-002 |
| 程式位置 | 純演算法 `app/utils/tuner/`（不放 `shared/`）；瀏覽器轉接層 `app/composables/useTuner.ts` + `app/composables/tuner/audioGraph.ts` | ADR-003 |
| 狀態管理 | 純函式 reducer `tunerReducer(state, event, params)`，時間由外部注入；平滑在「對數音高（MIDI 浮點）」域做中位數 + EMA | ADR-004 |
| 生命週期 | 單一 `AudioContext` 擁有者；手勢內啟動；`visibilitychange` / `pagehide` / `onBeforeUnmount` 一律完整釋放；**不自動重啟** | ADR-005 |
| 元件測試工具 | `@vue/test-utils` + `happy-dom` + `@vitejs/plugin-vue`，**不**引入 `@nuxt/test-utils` | ADR-006 |
| 參考音 | 頻率 = 目標頻率的 `PeriodicWave`（含泛音），非純正弦 | ADR-007 |

延遲估計（48 kHz，目標裝置）：撥弦越過閘門 → 畫面首次讀數約 **110–190 ms**，p90 低於 PRD 300 ms（§2.3）。

---

## 1. 依賴方向與模組總覽

PRD §7 的四個模組對應如下，依賴只能由外往內：

```
┌──────────────────────────────────────────────────────────────┐
│ 呈現層  app/pages/tuner.vue, app/components/tuner/*.vue       │  只讀 view、呼叫 composable 動作
└───────────────▲──────────────────────────────────────────────┘
                │
┌───────────────┴──────────────────────────────────────────────┐
│ (4) 瀏覽器轉接層  app/composables/useTuner.ts                 │  Vue 反應性、生命週期、手勢、storage
│                  app/composables/tuner/audioGraph.ts          │  getUserMedia / AudioContext / Analyser / Oscillator
└───────────────▲──────────────────────────────────────────────┘
                │  (只傳 Float32Array 與 performance.now())
┌───────────────┴──────────────────────────────────────────────┐
│ 純邏輯（Node 可測，不得 import vue / #imports / 瀏覽器全域）    │
│  pipeline.ts ── frameAnalysis.ts ── (2) pitchDetector.ts ── fft.ts
│      │                                                        │
│      └── (3) tunerMachine.ts ── tunerView.ts                  │
│                   │                                           │
│              (1) strings.ts ── params.ts                      │
│                   │                                           │
│           app/utils/music.ts（STANDARD_TUNING, NOTE_NAMES）     │
│  environment.ts（錯誤分類、UA 判斷）  referenceTone.ts（參考音計畫）│
└──────────────────────────────────────────────────────────────┘
```

規則（code review 檢查項）：
- `app/utils/tuner/**` 不得 import `vue`、`#imports`、`#app`，不得存取 `window`、`navigator`、`document`、`AudioContext`、`localStorage`。所有環境資訊以參數注入。
- `app/utils/tuner/` 不會被 Nuxt auto-import（Nuxt 只掃 `utils/` 第一層），一律**明確 import**，避免 `detectPitch` 之類的名稱污染全域。
- composable 與 tuner 元件內也**明確 import** `vue` API 與子元件（不依賴 auto-import），讓 Vitest 不需 Nuxt runtime 即可測試（ADR-006）。
- **未來重用**（`vision-roadmap.md` 階段 2「單音驗證」、階段 4「用吉他輸入旋律」）：`pitchDetector`、`frameAnalysis`、`audioGraph` 必須保持**不依賴** `tunerMachine` / `tunerView`，讓新功能能接上自己的狀態機。新功能用 `resolveParams()` 傳入自己的參數，**不得**為此修改 `TUNER_PARAMS` 的數值（那會改變調音器已驗收的行為）。

---

## 2. 音高偵測方案

### 2.1 基本數字

| 項目 | 44.1 kHz | 48 kHz | 96 kHz（部分桌機） |
|------|---------|--------|------|
| 最長週期 τmax = ⌈sr / 70⌉ | 630 | 686 | 1372 |
| 最短週期 τmin = ⌊sr / 450⌋ | 98 | 106 | 213 |
| E2 週期（82.41 Hz） | 535.1 | 582.4 | 1164.9 |
| E4 週期（329.63 Hz） | 133.8 | 145.6 | 291.2 |
| 視窗 W | 2048（46.4 ms） | 2048（42.7 ms） | 4096（42.7 ms） |
| 視窗內 70 Hz 週期數 / E2 週期數 | 3.25 / 3.8 | 2.99 / 3.5 | 2.99 / 3.5 |
| 1 sample 的 lag 對 E4 相當於 | 約 13 cents | 約 12 cents | 約 6 cents |

`windowSizeFor(sr) = nextPow2(ceil(2.8 × sr / minFreq))` → 1764→2048、1920→2048、3840→4096。必須是 2 的冪，因為 `AnalyserNode.fftSize` 只接受 2 的冪，且 FFT 也需要。

最後一列說明為什麼**必須做次樣本內插**：整數 lag 的量化誤差在高音弦達 ±6 cents，遠超 ±1 cent。

### 2.2 候選演算法比較

| 演算法 | 原理 | ±1 cent（合成） | 八度誤判 | 所需視窗 / 延遲 | 運算成本 | 評價 |
|--------|------|---------------|---------|----------------|---------|------|
| **FFT + HPS** | 頻譜乘上降取樣頻譜，找共同基頻 | **做不到**：W=2048 @48k 的 bin 寬 23.4 Hz，在 82 Hz 約 450 cents；要到數 cents 需 > 0.5 s 視窗 | 對「基頻弱」有效（就是為缺失基頻設計），但易落到低八度 | 長視窗 → 首讀數 > 300 ms | O(N log N)，便宜 | 不採用。精度與延遲都過不了 TUN-20/23 |
| **純 autocorrelation (ACF)** | r(τ) 找最大峰 | 可（內插），但 r(τ) 隨 τ 線性衰減（重疊項變少）造成峰值偏移 | 差：未正規化，最大峰常落在錯誤倍數；門檻與音量相關 | ≥ 2 週期 | O(N log N)（FFT） | 不採用，MPM 是它的正規化版本 |
| **YIN** | 差分函式 d(τ) → 累積均值正規化 d'(τ) → 第一個低於絕對門檻（0.1–0.15）的谷 | 可（拋物線內插；原論文建議在 d 而非 d' 上內插以減少偏差） | 好：取「第一個」夠深的谷偏向基頻；但強第 2 泛音時仍可能停在 T/2 | 需 τmax + 積分視窗 ≈ 2τmax；W=2048 剛好 | 直接算 O(W·τmax) ≈ 0.9 M 乘加/幀；可 FFT 化 | 可行的備案 |
| **MPM（McLeod）** | NSDF n(τ) = 2r(τ)/m(τ)，值域 [−1, 1]；取第一個 ≥ k·max 的 key maximum | 可（拋物線內插）；NSDF 對指數衰減自我正規化（見下） | 好：k 門檻 + 子八度檢查；clarity 直接可當可信度 | **約 2 週期即可**（用全部重疊區），對短視窗最友善 | 同上，以 FFT 計算約 0.3–1 ms/幀 | **採用** |

選 MPM 而非 YIN 的理由（細節見 ADR-001）：
1. **clarity ∈ [0,1] 直接對應 PRD 參數**（MPM clarity ≥ 0.9），不需另外換算「非週期性」。
2. NSDF 使用整個重疊區，W=2048 時 70 Hz 仍有約 2 個週期可用，對低音延遲較有利。
3. 專為樂器調音（Tartini）設計，peak picking 規則簡單、文獻多。
4. YIN 與 MPM 共用同一套 FFT 自相關基礎設施（d(τ) = m(τ) − 2r(τ)），若 M0 fixture 顯示 MPM 在第 6 弦不如預期，切換成本約 1 天（`PitchDetector` 介面不變）。

### 2.3 延遲：W=2048 對照 300 ms

以 48 kHz、60 次/秒分析為例，從「撥弦訊號越過雜訊閘門」起算：

| 階段 | 估計 | 說明 |
|------|------|------|
| 麥克風 → AudioContext 輸入延遲 | 10–40 ms | OS / 瀏覽器緩衝，Android 中階機偏高；量 TUN-20 時已包含 |
| 起音（attack）不穩段 | 20–40 ms | 撥弦瞬間噪音多、clarity 低，分析結果為 unclear |
| 視窗大部分被新訊號填滿 | 0–43 ms | 與 attack 重疊，不完全相加 |
| 穩定性檢查（連續 3 次估計相差 ≤ 20 cents） | +2 幀 ≈ 33 ms | TUN-34；第 1 次合格估計後再等 2 幀 |
| 平滑 | 0 ms | 第一個值直接初始化平滑器，不等收斂 |
| Vue 更新 + 下一次 paint | ≤ 17 ms | |
| **合計** | **約 110–190 ms** | p90 < 300 ms；離線 F 測試要求 onset → 第一個有效讀數 ≤ 150 ms（訊號時間） |

若 M0 發現第 6 弦需要 W=4096（+43 ms），合計仍約 150–230 ms，在預算內。這是一個參數，不是架構變更。

### 2.4 演算法規格（`pitchDetector.ts`）

每幀輸入 `Float32Array` 長度 W，輸出 `PitchEstimate | null`：

1. **去直流**：減去平均值（部分手機麥克風有 DC 偏移，會讓 NSDF 偏高）。以 `Float64Array` 累加。
1a. **低通（實作時新增，`lowpassHz`，初始 5 kHz）**：零相位（正向 + 反向）雙二階低通。原因：不加的話 SNR 20 dB 時每幀抖動約 3 cents，中位數 + EMA 壓不到 TUN-38 要求的 ≤ 1 cent（本節原估計 < 0.5 並不成立），把 EMA 調慢又會違反 300 ms 階躍要求。實測截止頻率 1.5 kHz 誤差 2.2 cents、3 kHz 0.86、5 kHz 0.47。截止頻率 ≥ Nyquist 或設為 0 時關閉。測試以「濾波開/關的估計差 < 0.5 cent」把關（FFT 版 NSDF 的參考比對在關閉濾波下進行）。替代方案：在音訊圖放 `BiquadFilterNode`（連續濾波、無邊緣暫態），但離線測試就不再走完全相同的路徑。
2. **NSDF（FFT 版）**：
   - 補零至 N = 2W（4096），做複數 FFT → 取 |X|² → 反 FFT，得線性自相關 r(τ)，τ = 0..W−1。
   - m(τ) 以遞迴求：m(0) = 2Σx²；m(τ) = m(τ−1) − x[τ−1]² − x[W−τ]²。
   - n(τ) = 2r(τ) / m(τ)（m 很小時 n = 0）。
   - 所有緩衝區在 `createPitchDetector` 時一次配置，每幀**零配置**（避免 GC 停頓）。
3. **找 key maxima**：搜尋範圍 τ ∈ [2, min(W−2, ⌈1.1·τmax⌉)]。每段「n 由負轉正的零交越」到「下一個由正轉負的零交越」之間取最大值為一個 key maximum。最後一段若在搜尋範圍終點前未轉負：峰值卡在搜尋範圍終點（邊界）時**丟棄**；峰值在區段內部（n[best+1] < n[best]）時**保留**。（實作時修改：原規則一律丟棄，但 70–75 Hz 純正弦的零交越落在 1.1·τmax 之外，72 Hz 會變成無效，違反 TUN-22。）
4. **選峰**：nMax = 所有 key maxima 的最大值；取**第一個** n ≥ k·nMax 的 key maximum（k = `TUNER_PARAMS.mpmK`，初始 0.93）。
5. **範圍判斷（重要）**：key maxima 的搜尋**包含 τ < τmin**。若選中的峰 τ < τmin（> 450 Hz）就回傳 `null`，**不可**跳過它往後找——否則 460 Hz 正弦會在 2 倍週期處被報成 230 Hz（八度錯誤，違反 TUN-22）。同理 τ > τmax 回傳 `null`。
6. **拋物線內插**：以 (τ−1, τ, τ+1) 三點求頂點 τ\* 與頂點值 n\*。clarity = n\*（夾在 [0,1]）。
   - 準確度分析：NSDF 在峰附近近似 cos(ωτ)，ω = 2π/週期；拋物線內插誤差與 ω² 成正比。E4 @48k 時 ω ≈ 0.043 rad/sample，含到第 6 泛音 ω₆ ≈ 0.26，內插誤差 < 0.01 sample（< 0.15 cent）。
   - 撥弦的指數衰減：r(τ) 帶 e^(−ατ) 因子，但 m(τ) 也帶同階因子，NSDF ≈ cos(ωτ)/cosh(ατ)，峰值偏移是 α² 的二階小量（α ≈ 2×10⁻⁵/sample），可忽略。這也是選正規化方法而非純 ACF 的原因。
7. **子八度檢查（octave guard）**：吉他第 6 弦常見「第 2 泛音比基頻強」，此時 n(T/2) 可能 ≥ k·n(T) 而被選中（報成 E3）。檢查 m ∈ {2, 3}：若在 m·τ\* ± 3% 內有 key maximum、該位置 ≤ τmax，且 n(mτ\*) − n(τ\*) ≥ `octaveGuardMargin`（初始 0.01；原為 0.05），改選該峰（取符合條件中 n 最大者），重做內插。範圍判斷（第 5 步）在子八度檢查**之後**進行，讓「T/2 超出範圍、但 2T 正確」的情況能被修正。
   - 為何從 0.05 降到 0.01（code review I3）：選中 T/2 的前提是 n(T/2) ≥ k·nMax ≈ nMax − 0.069，修正又需要 n(T) − n(T/2) ≥ margin，兩者交集只有 n(T/2) ∈ [nMax − 0.069, nMax − margin]。margin 0.05 時只剩約 0.02 寬，泛音 `[0.1,1,0,0.3]` 或 `[0.1,1,0.1,0.5]` 的 E2 會 100% 報成 E3；0.01 時合成測試全數修正，且 D3–E4 加雜訊不會被誤判成低八度（有回歸測試）。
   - 為何不會誤把正確的 T 降成 2T：對真正週期 T，n(2T) ≈ n(T) 減去衰減與重疊減少的損失，差值為負，不會觸發。
   - 為何會修正 T/2：在 T/2 處奇次泛音（含基頻）貢獻為負，n(T/2) 明顯低於 n(T)。
   - `mpmK` 與 `octaveGuardMargin` 由 M0 fixtures 校準（TUN-25）；合成「基頻弱」測試在 fixtures 到位前先守住這條路徑。
8. **頻率** = sampleRate / τ\*。

**成本**：每幀 2 次 4096 點複數 FFT（約 2.5 萬個蝶形）+ 數個 O(W) 迴圈，JS 約 0.3–1 ms（中階 Android）。60 幀/秒 ≈ 主執行緒 2–6%。直接 O(W·τmax) 實作約 1.2 M 乘加/幀（2–4 ms，12–24%），只用在測試中作為參考實作驗證 FFT 版結果一致。

---

## 3. 執行方式：AnalyserNode 輪詢（主執行緒）

### 3.1 選項

| 選項 | 優點 | 缺點 |
|------|------|------|
| **A. `AnalyserNode` + rAF 輪詢**（採用） | 無額外打包；iOS 14.5+ 即支援 `getFloatTimeDomainData`；與畫面更新同步；最容易 mock；SSR 無影響 | 取到的是「最近 W 個樣本」，幀與幀之間可能重疊或略過樣本（對調音器無害）；分析在主執行緒 |
| B. `AudioWorklet` 收集樣本 → `MessagePort` 送主執行緒分析 | 樣本連續、不漏；時間戳精確 | 處理器必須是獨立模組檔，由 `audioWorklet.addModule(url)` 載入：Vite 需 `?worker&url` / `?url` 之類技巧，dev 模式注入的 `/@vite/client` 等模組在 worklet scope 會出問題，TS 需另外編譯或放 `public/` 寫純 JS（失去型別與共用程式）；Nitro/SSR 打包要排除；iOS 16.4 支援但 Safari 的 worklet 行為差異需額外實機驗證 |
| C. B + 在 worklet 內直接分析 | 不佔主執行緒 | 音訊執行緒每 128 樣本（2.7 ms）一個 render quantum，在此做 FFT 會造成 glitch，違反 worklet 用法 |
| D. A + Web Worker 分析 | 主執行緒更空 | 每幀 postMessage 一份 8 KB 陣列；`?worker` 打包；測試多一層；在 FFT 版成本 ≤ 1 ms 時沒有可量測的收益 |

### 3.2 決定

採用 **A**。分析成本 ≤ 1 ms/幀，主執行緒負擔遠低於 PRD「≥ 30 fps」的風險線；而 B/C/D 的打包與實機風險落在 M0/M1 最緊的時程上。

可逆性：`pitchDetector` 與 `pipeline` 是同步純函式，輸入只有 `Float32Array`。若實機量到掉幀，可只換轉接層：先改 D（Worker 內跑 `pipeline.process`），再考慮 B。觸發條件寫在 ADR-002。

### 3.3 音訊圖

```
MediaStream (mic) ──► MediaStreamAudioSourceNode ──► AnalyserNode(fftSize = W)
                                                       （不接 destination，避免回授）
OscillatorNode(PeriodicWave) ──► GainNode(envelope) ──► destination   （參考音）
```

- `new AudioContext()` **不指定 sampleRate**，之後讀 `ctx.sampleRate` 建立 pipeline（PRD §7：iOS 可能是 44.1 或 48 kHz）。
- `latencyHint` 用預設 `'interactive'`。
- `AnalyserNode` 未接 destination 時，M0 需在 iOS Safari 驗證仍會更新資料；若不會，把 `audioGraph.ts` 的 `PULL_ANALYSER_THROUGH_DESTINATION` 改成 `true`，即改接 `analyser → GainNode(gain=0) → destination`（已實作，預設關閉）。
- 參考音提前停止時，淡出優先用 `AudioParam.cancelAndHoldAtTime`（舊版 Safari 在排程中讀 `gain.value` 可能拿不到目前的自動化值）；不支援時退回 `cancelScheduledValues + setValueAtTime`。`onended` 在 context 被系統暫停時不會觸發，另有 `durationS + 0.5 s` 的計時器保底結束。
- 多聲道輸入由 `AnalyserNode` 自動 down-mix 成單聲道。

### 3.4 分析迴圈

```ts
// useTuner 內部（示意）
function loop(t: number) {
  rafId = requestAnimationFrame(loop)
  if (t - lastAnalysisAt < TUNER_PARAMS.minAnalysisIntervalMs) return  // 15 ms：60/90/120 Hz 螢幕都約 45–60 次/秒
  lastAnalysisAt = t
  if (referencePlaying) return                                         // TUN-92：播參考音時不分析
  if (performance.now() < analysisResumeAt) return                     // 參考音結束後：輸出延遲 + 淡出 + 150 ms 尾音緩衝
  analyser.getFloatTimeDomainData(frameBuf)                            // frameBuf 預先配置，長度 W
  const s = pipeline.process(frameBuf, performance.now())
  if (viewChanged(s)) state.value = s                                  // shallowRef，避免每幀觸發無意義 render
}
```

- 低電量模式下 rAF 可能降到 30 Hz，仍 ≥ 10 次/秒（TUN-21）。
- 切背景時 rAF 停止，但我們本來就在 `visibilitychange` 釋放麥克風（TUN-61）。
- 離線測試以 hop = round(sr / 60)（735 / 800 samples，≤ 1024，符合 PRD）模擬同一速率。

---

## 4. 雜訊閘門與穩定化

### 4.1 每幀分析（`frameAnalysis.ts`）

```
frame ─► RMS → dBFS ─┬─ < gate ─────────────────────────► { kind: 'silent' }
                     └─ ≥ gate ─► detector.detect()
                                   ├─ null / 超出 70–450 Hz ─► { kind: 'unclear', reason: 'no-pitch' | 'out-of-range' }
                                   ├─ clarity < 0.9 ────────► { kind: 'unclear', reason: 'low-clarity' }
                                   └─ ok ───────────────────► { kind: 'pitched', freq, clarity }
```

- dBFS = 20·log10(RMS)，RMS 為去直流後的值；全 0 時為 `-Infinity`。
- **閘門遲滯**（新增參數，見 §10）：閘門關閉時需 ≥ −50 dBFS 才打開；打開後低於 −53 dBFS 才關閉，避免撥弦衰減時在門檻附近閃爍。若 PM 不同意，把 `gateCloseDbfs` 設成與 `gateOpenDbfs` 相同即等於無遲滯。
- 閘門狀態存在 reducer state 內（不是 detector），讓 frameAnalysis 維持無狀態：`analyzeFrame(frame, detector, params, gateWasOpen)`。

### 4.2 Reducer 處理順序（`tunerMachine.ts`，每個 `frame` 事件）

1. **穩定性（TUN-34）**：`pitched` 估計推入 `recent`（最多 3 筆，存 MIDI 浮點）。非 `pitched` 幀清空 `recent`。只有 `recent` 滿 3 筆且 max − min ≤ 0.20 半音（20 cents）時，這一幀才是**有效讀數**；否則視同 unclear（不更新顯示）。
2. **目標弦**（見下方第 3 點；實作時移到平滑**之前**）：自動模式候選弦未確認時，這一幀**不更新讀數**，直接走保留路徑（code review I1：否則平滑值已跳到新音、目標弦還是舊弦，會顯示「舊弦 +500 ¢」甚至沿用「準了」）。
   **平滑（TUN-38）**，在 MIDI 浮點（對數頻率）域：
   - 若 |新值 − 目前平滑值| > 0.5 半音（50 cents）→ **重置**（換音或換弦），平滑值直接等於新值。
   - 否則推入中位數緩衝（5 筆）→ 取中位數 → EMA：`α = 1 − exp(−Δt / τ)`，τ = 80 ms，Δt 為與上一個有效讀數的時間差（不同幀率下行為一致）。
   - 步階 −20 → 0 cents：中位數延遲約 3 幀（≈ 50 ms）+ EMA 到剩 10%（2 cents）需 2.3τ ≈ 185 ms → 約 235 ms < 300 ms。
   - 穩定音標準差：中位數去除離群 + EMA 等效平均約 5–10 幀，SNR 20 dB 下預期 < 0.5 cent。
3. **目標弦（TUN-10/11）**：
   - 手動模式：固定所選弦。
   - 自動模式：`nearestStringIndex(freq)`（等距取較低弦）。若目前沒有弦（剛從等待中進來）→ 立即採用。若與目前弦不同 → 累積 `autoCandidate`；同一候選**連續 ≥ 3 個有效讀數且 ≥ 100 ms** 才切換（見 §10 第 1 點）；中間出現回到原弦的讀數就清空候選。
   - 以本幀**原始估計**判斷最近弦（不用平滑值：平滑值在 95.2 Hz 交界附近會連續停在同一側好幾幀，可能誤觸發切換）。
   - 候選累積期間不更新讀數（見第 2 點）；確認切換後「準了」判定重設為 tracking。
   - 換弦時平滑器不需重置（平滑的是絕對音高），cents 直接重算。
4. **顯示值**：`cents = 1200·log2(f_smoothed / f_target)`；`displayCents = roundHalfAwayFromZero(cents)`。注意 `Math.round(-5.5) === -5`，必須用對稱捨入，否則 ±5 邊界不對稱；並把 `-0` 正規化為 `0`。
5. **「準了」遲滯（TUN-30/31/32）**：只看 `displayCents`（與畫面同一個值）。

   ```
              |d| ≤ 5（記錄 since）               |d| ≤ 5 持續 ≥ 500 ms
   [tracking] ───────────────────► [approaching] ───────────────────► [inTune]
       ▲  ▲                            │ |d| > 5 或 讀數中斷 > 200 ms     │
       │  └────────────────────────────┘                                 │
       │            |d| > 7 持續 ≥ 200 ms（期間任一 |d| ≤ 7 讀數即重新計時） │
       └─────────────────────────────────────────────────────────────────┘
   ```

   - 「持續」以讀數時間戳判斷；approaching 期間允許偶發 unclear 幀，但連續無有效讀數 > `inTuneMaxGapMs`（200 ms；原為 100 ms）就重新計時。inTune 的退出計時同樣適用（code review M1：與進入對稱）。
   - 為何 200 ms（code review I2）：一個 unclear 幀會清空 `recent`，要再 3 幀才有有效讀數，間隔為 4 個幀距：60 fps 約 67 ms，30 fps（中階 Android、iOS 低耗電模式）約 133 ms。100 ms 會讓 30 fps 下偶發雜訊時永遠進不了「準了」。
   - 在 inTune 狀態下 |d| 為 6 或 7 時仍顯示「準了」（遲滯帶）。
   - 訊號消失（silent）**不**退出 inTune（TUN-31），交給保留機制。
6. **保留與淡出（TUN-35）**：最後一個有效讀數後，若持續 silent 或 unclear，保留顯示（含 inTune）1.5 s，之後回到 `waiting` 並重置 tune 狀態、目前弦（自動模式）、平滑器、`recent`。
7. **吵雜提示（TUN-36）**：閘門打開但非有效讀數的狀態（unclear 或不穩定）連續 > 2 s → `noisyHint = true`；出現有效讀數或閘門關閉即清除。
8. **暫停（TUN-92）**：`{ type: 'suspend' }` 事件（參考音播放、暫停、模式切換時）把 state 重置為 waiting，但保留 mode。

所有時間比較都用事件帶入的 `now`（ms），reducer 內不呼叫 `Date.now()` / `performance.now()`，因此可用合成時間序列做確定性測試。

---

## 5. 檔案與公開 API

### 5.1 為何放 `app/utils/` 而非 `shared/`

`shared/` 在 Nuxt 4 是給 `app/` 與 `server/` 共用的程式。調音器全部在 client 執行，PRD 也禁止伺服器端處理音訊（TUN-80/81）；放 `shared/` 只會讓人誤以為 server 可以用。另外現有 `vitest.config.ts` 只設定 `~ → app/`，放 `app/utils/tuner/` 不需改 alias。純度由 §1 的規則與 `tests/tuner/purity.spec.ts`（掃描 import）保證，不靠目錄名稱。

### 5.2 檔案清單

| 檔案 | 層 | 測試 |
|------|----|------|
| `app/utils/music.ts`（修改） | 純 | U |
| `app/utils/tuner/params.ts` | 純 | — |
| `app/utils/tuner/strings.ts` | 純（模組 1） | U |
| `app/utils/tuner/fft.ts` | 純 | U |
| `app/utils/tuner/pitchDetector.ts` | 純（模組 2） | U/F |
| `app/utils/tuner/frameAnalysis.ts` | 純 | U |
| `app/utils/tuner/tunerMachine.ts` | 純（模組 3） | U |
| `app/utils/tuner/tunerView.ts` | 純 | U |
| `app/utils/tuner/pipeline.ts` | 純（組裝 2+3，瀏覽器與離線測試共用） | U/F |
| `app/utils/tuner/environment.ts` | 純 | U |
| `app/utils/tuner/referenceTone.ts` | 純 | U |
| `app/composables/tuner/audioGraph.ts` | 轉接（模組 4，無 Vue） | C |
| `app/composables/useTuner.ts` | 轉接（模組 4，Vue） | C |
| `app/data/tuner-copy.ts` | 資料（PRD 文案） | C |
| `app/pages/tuner.vue` | 呈現 | C/M |
| `app/components/tuner/TunerPanel.vue` | 呈現（容器） | C |
| `app/components/tuner/TunerStartCard.vue` | 呈現 | C |
| `app/components/tuner/TunerMeter.vue` | 呈現 | C |
| `app/components/tuner/TunerStringSelector.vue` | 呈現 | C |
| `app/components/tuner/TunerErrorNotice.vue` | 呈現 | C |
| `app/components/tuner/TunerReferenceTones.vue` | 呈現 | C |
| `app/pages/index.vue`、`app/pages/practice.vue`（修改，P0-3 入口） | 呈現 | M |

Nuxt 元件命名：`components/tuner/TunerMeter.vue` 的自動名稱是 `TunerMeter`（路徑前綴與檔名重複部分會合併）。但 tuner 元件之間仍明確 import（ADR-006）。

### 5.3 公開 API

#### `app/utils/music.ts`（新增）

```ts
/** 十二平均律，A4 = 440 Hz。TUN-01：調音器所有頻率都經由此函式由 STANDARD_TUNING 算出 */
export function midiToFrequency(midi: number, a4 = 440): number   // 440 * 2 ** ((midi - 69) / 12)
export function frequencyToMidi(freq: number, a4 = 440): number   // 69 + 12 * log2(freq / a4)，回傳浮點
export const noteOctave = (midi: number): number => Math.floor(midi / 12) - 1
export const noteLabel = (midi: number): string => `${pitchClass(midi)}${noteOctave(midi)}`  // 40 → 'E2'
```

#### `app/utils/tuner/params.ts`

```ts
export interface TunerParams {
  minFreq: number              // 70
  maxFreq: number              // 450
  gateOpenDbfs: number         // -50
  gateCloseDbfs: number        // -53（= gateOpenDbfs 則無遲滯）
  minClarity: number           // 0.9
  mpmK: number                 // 0.93
  octaveGuardMargin: number    // 0.01（原 0.05，見 §2.4 第 7 步）
  lowpassHz: number            // 5000；0 = 關閉（見 §2.4 第 1a 步）
  stabilityCount: number       // 3
  stabilityMaxSpreadCents: number // 20
  medianSize: number           // 5
  emaTimeConstantMs: number    // 80
  resetJumpCents: number       // 50
  autoSwitchCount: number      // 3
  autoSwitchMinMs: number      // 100
  inTuneEnterCents: number     // 5
  inTuneEnterMs: number        // 500
  inTuneExitCents: number      // 7
  inTuneExitMs: number         // 200
  inTuneMaxGapMs: number       // 200（原 100，見 §4.2 第 5 點）
  holdMs: number               // 1500
  noisyHintMs: number          // 2000
  needleRangeCents: number     // 50
  minAnalysisIntervalMs: number // 15
}
export const TUNER_PARAMS: Readonly<TunerParams>
export function windowSizeFor(sampleRate: number, minFreq?: number): number  // 2048 @≤48k，4096 @96k
```

#### `app/utils/tuner/strings.ts`（模組 1）

```ts
import type { NoteName } from '~/types/chord'

export interface TunerString {
  index: number          // 0..5，0 = 第 6 弦（與 STANDARD_TUNING 相同）
  stringNumber: number   // 6..1（顯示「第 N 弦」）
  midi: number           // STANDARD_TUNING[index]
  name: NoteName         // 'E'
  octave: number         // 2
  label: string          // 'E2'
  frequency: number      // midiToFrequency(midi)，不得寫死
}
export const TUNER_STRINGS: readonly TunerString[]   // 由 STANDARD_TUNING.map(...) 產生

export type TunerMode = { kind: 'auto' } | { kind: 'manual'; stringIndex: number }

export function centsBetween(freq: number, reference: number): number   // 1200 * log2(freq / reference)
export function nearestStringIndex(freq: number): number                 // 比較 |cents|，相等取較低弦（較小 index）
export function frequencyToTarget(freq: number, mode: TunerMode): { string: TunerString; cents: number }

/** TUN-15：localStorage 讀寫的純函式部分（容錯，壞資料回傳 null） */
export function serializeMode(mode: TunerMode): string            // JSON，含 v: 1
export function parseStoredMode(raw: string | null): TunerMode | null
export const TUNER_MODE_STORAGE_KEY = 'guitar-learning:tuner-mode:v1'
```

#### `app/utils/tuner/fft.ts`

```ts
/** 預先配置的 radix-2 複數 FFT；size 必須是 2 的冪 */
export interface Fft { readonly size: number; forward(re: Float64Array, im: Float64Array): void; inverse(re: Float64Array, im: Float64Array): void }
export function createFft(size: number): Fft
```

#### `app/utils/tuner/pitchDetector.ts`（模組 2）

```ts
export interface PitchEstimate { freq: number; clarity: number }   // clarity = 內插後 NSDF 峰值 ∈ [0,1]

export interface PitchDetectorOptions {
  sampleRate: number
  windowSize: number
  minFreq: number
  maxFreq: number
  k: number
  octaveGuardMargin: number
}
export interface PitchDetector {
  readonly options: Readonly<PitchDetectorOptions>
  /** frame.length 必須 === windowSize；不配置記憶體；超出範圍或無峰回傳 null */
  detect(frame: Float32Array): PitchEstimate | null
}
export function createPitchDetector(options: PitchDetectorOptions): PitchDetector

/** PRD §7 建議的便利函式；每次呼叫都新建 detector，只用於測試/離線 */
export function detectPitch(frame: Float32Array, sampleRate: number, params?: Partial<TunerParams>): PitchEstimate | null

export function computeRms(frame: Float32Array): number     // 去直流後
export function toDbfs(rms: number): number                 // 20 * log10(rms)，0 → -Infinity
```

#### `app/utils/tuner/frameAnalysis.ts`

```ts
export type FrameAnalysis =
  | { kind: 'silent'; dbfs: number }
  | { kind: 'unclear'; dbfs: number; reason: 'no-pitch' | 'out-of-range' | 'low-clarity' }
  | { kind: 'pitched'; dbfs: number; freq: number; clarity: number }

export function analyzeFrame(frame: Float32Array, detector: PitchDetector, params: TunerParams, gateWasOpen: boolean): FrameAnalysis
```

#### `app/utils/tuner/tunerMachine.ts`（模組 3）

```ts
export type TuneStatus = 'tracking' | 'approaching' | 'inTune'

export interface TunerReading {
  stringIndex: number
  freq: number            // 平滑後頻率
  cents: number           // 平滑後浮點 cents（對目標弦）
  displayCents: number    // 對稱捨入後整數；判定「準了」與畫面都用它
  at: number              // 最後一次有效讀數時間（ms）
}

export interface TunerState {
  mode: TunerMode
  gateOpen: boolean
  signal: 'waiting' | 'active' | 'holding'
  reading: TunerReading | null
  tune: { status: TuneStatus; since: number | null; exitSince: number | null }
  noisyHint: boolean
  // 內部（測試可讀，UI 不應依賴）
  recent: number[]                 // 最近 pitched 估計（MIDI 浮點）
  median: number[]
  smoothedMidi: number | null
  autoCandidate: { stringIndex: number; count: number; since: number } | null
  unclearSince: number | null
}

export type TunerEvent =
  | { type: 'frame'; analysis: FrameAnalysis; now: number }
  | { type: 'setMode'; mode: TunerMode; now: number }
  | { type: 'suspend' }            // 參考音播放、暫停、停止

export function createInitialTunerState(mode?: TunerMode): TunerState
export function tunerReducer(state: TunerState, event: TunerEvent, params?: TunerParams): TunerState  // 純函式，回傳新物件
```

#### `app/utils/tuner/tunerView.ts`

```ts
export type TunerStatusKind = 'waiting' | 'tooLow' | 'tooHigh' | 'farLow' | 'farHigh' | 'approaching' | 'inTune'

export interface TunerView {
  status: TunerStatusKind
  string: TunerString | null       // 目前/所選弦（手動模式時等待中也有值，用於選弦列高亮）
  noteName: string | null          // 'A'（等待中為 null）
  noteLabel: string | null         // 'A2'
  stringLabel: string | null       // '第 5 弦'
  centsText: string | null         // '−12 ¢'（U+2212）、'+3 ¢'、'0 ¢'
  frequencyText: string | null     // '109.6 Hz'
  needle: number                   // −1..1，|cents| > 50 固定在端點（TUN-13/14），等待中為 0
  directionText: string | null     // 依 TUN-42 / TUN-13 文案
  isManual: boolean
  noisyHint: boolean
  fading: boolean                  // holding 中，供 UI 淡出
  announcement: string             // 只隨 status 類別改變（等待中 / 有讀數 / 準了），給 aria-live（TUN-45）
}

export function selectTunerView(state: TunerState, params?: TunerParams): TunerView
export function formatCents(displayCents: number): string
export function formatFrequency(freq: number): string
export function needlePosition(cents: number, rangeCents?: number): number
export function roundHalfAwayFromZero(x: number): number
```

#### `app/utils/tuner/pipeline.ts`

```ts
export interface TunerPipeline {
  readonly sampleRate: number
  readonly windowSize: number
  readonly state: TunerState
  process(frame: Float32Array, now: number): TunerState   // analyzeFrame + tunerReducer
  dispatch(event: Exclude<TunerEvent, { type: 'frame' }>): TunerState
}
export function createTunerPipeline(opts: { sampleRate: number; mode?: TunerMode; params?: Partial<TunerParams> }): TunerPipeline
```

瀏覽器與離線測試走**同一條** `pipeline.process`，F 測試結果才能代表實機行為。

#### `app/utils/tuner/environment.ts`

```ts
export type TunerErrorKind = 'permission-denied' | 'not-found' | 'not-readable' | 'unknown'
export type EnvironmentStatus =
  | { ok: true }
  | { ok: false; reason: 'insecure' | 'unsupported'; audioOutputAvailable: boolean }
export type InAppBrowser = 'line' | 'instagram' | 'facebook'

/** 判斷順序固定：secure context → API 支援（PRD §5.1.6） */
export function checkEnvironment(env: { isSecureContext: boolean; hasGetUserMedia: boolean; hasAudioContext: boolean }): EnvironmentStatus
export function classifyStartError(error: unknown): TunerErrorKind
export function detectInAppBrowser(userAgent: string): InAppBrowser | null   // /\bLine\//i、/Instagram/、/FBAN|FBAV|FB_IAB|FBIOS/
```

#### `app/utils/tuner/referenceTone.ts`

```ts
export interface ReferenceTonePlan {
  frequency: number         // = TUNER_STRINGS[i].frequency（TUN-90）
  durationS: number         // 2
  fadeInS: number           // 0.03（≥ 0.02）
  fadeOutS: number          // 0.08
  peakGain: number          // 0.3
  harmonics: readonly number[]  // PeriodicWave 實部係數：[0, 1, 0.6, 0.4, 0.25, 0.15, 0.1]
}
export function referenceTonePlan(stringIndex: number): ReferenceTonePlan
```

#### `app/composables/tuner/audioGraph.ts`（瀏覽器 API，無 Vue）

```ts
export const MIC_CONSTRAINTS: MediaStreamConstraints  // { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false }（非 exact，避免 OverconstrainedError）

export function getAudioContextCtor(): typeof AudioContext | undefined   // window.AudioContext ?? window.webkitAudioContext
export function readEnvironment(): { isSecureContext: boolean; hasGetUserMedia: boolean; hasAudioContext: boolean }

export interface MicInput {
  analyser: AnalyserNode
  stream: MediaStream
  release(): void           // disconnect + 所有 track.stop()；可重複呼叫
}
export function connectMicrophone(ctx: AudioContext, stream: MediaStream, fftSize: number): MicInput

export interface ToneHandle { stop(): void; readonly ended: Promise<void> }
export function playReferenceTone(ctx: AudioContext, plan: ReferenceTonePlan): ToneHandle
```

#### `app/composables/useTuner.ts`

```ts
export type TunerPhase =
  | { kind: 'checking' }                                           // SSR 與 onMounted 之前
  | { kind: 'idle' }                                               // TUN-50
  | { kind: 'starting' }                                           // TUN-51
  | { kind: 'running' }                                            // TUN-52 之後
  | { kind: 'paused'; reason: 'hidden' | 'interrupted' | 'track-ended' }   // TUN-62
  | { kind: 'error'; error: TunerErrorKind; inAppBrowser: InAppBrowser | null }        // TUN-53/54/55/59 (+58)
  | { kind: 'blocked'; reason: 'insecure' | 'unsupported'; audioOutputAvailable: boolean; inAppBrowser: InAppBrowser | null } // TUN-56/57 (+58)

export interface UseTuner {
  phase: Readonly<Ref<TunerPhase>>
  view: Readonly<ComputedRef<TunerView>>
  mode: Readonly<Ref<TunerMode>>
  referencePlaying: Readonly<Ref<number | null>>  // 正在播放的 stringIndex
  /** 必須在 click handler 中「同步」呼叫（內部先同步建立/resume AudioContext 與呼叫 getUserMedia，再 await） */
  start(): Promise<void>
  stop(): void
  /** 選弦列：點同一弦或 'auto' 回自動（TUN-12），寫入 localStorage（TUN-15） */
  selectString(stringIndex: number | 'auto'): void
  /** 參考音：同弦再按 = 停止；他弦 = 換播（TUN-91）；播放中暫停偵測（TUN-92） */
  toggleReference(stringIndex: number): void
}
export function useTuner(): UseTuner
```

只在 `setup` 中呼叫。所有瀏覽器存取都在 `onMounted` 或使用者事件內，`setup` 階段只建立 ref。

#### `app/data/tuner-copy.ts`

```ts
export const tunerCopy: {
  intro: { title: string; body: string; startButton: string }   // TUN-50
  starting: string                                                // TUN-51
  waiting: string                                                 // TUN-33/52「請撥一條空弦」
  direction: { tooLow: string; tooHigh: string; farLow: string; farHigh: string; approaching: string; inTune: string }
  noisy: string                                                   // TUN-36
  paused: string                                                  // TUN-62
  referencePlaying: string                                        // TUN-92
  errors: Record<TunerErrorKind | 'insecure' | 'unsupported', string>
  permissionSteps: { ios: string; android: string; desktop: string; fallback: string }   // TUN-53
  inAppHint: string                                               // TUN-58
  privacy: string                                                 // TUN-83
  referenceHint: string                                           // TUN-94
  retry: string
}
export function permissionPlatform(userAgent: string): 'ios' | 'android' | 'desktop'
```

#### 元件 props / emits

| 元件 | Props | Emits |
|------|-------|-------|
| `TunerPanel` | 無（內部呼叫 `useTuner()`） | — |
| `TunerStartCard` | `starting: boolean` | `start` |
| `TunerMeter` | `view: TunerView` | — |
| `TunerStringSelector` | `activeIndex: number \| null`, `mode: TunerMode` | `select(index: number \| 'auto')` |
| `TunerErrorNotice` | `phase: Extract<TunerPhase, { kind: 'error' \| 'blocked' \| 'paused' }>`, `userAgent: string` | `retry` |
| `TunerReferenceTones` | `playingIndex: number \| null`, `disabled: boolean` | `toggle(index: number)` |

`TunerMeter` 規則：指針用 `transform: translateX()`，`@media (prefers-reduced-motion: reduce)` 時不加 transition；「準了」同時顯示綠色、打勾圖示（SVG）與文字（TUN-43）；`aria-live="polite"` 區塊**常駐在 `TunerPanel`**（不放在以 v-if 掛載的 `TunerMeter`：插入時就帶內容的 live region 多半不會被讀出），running 時綁 `view.announcement`，播放參考音時改為「播放參考音中」，其他階段為空字串（TUN-45）。

---

## 6. SSR 安全與生命週期

### 6.1 SSR

- `app/pages/tuner.vue`：SSR 只輸出靜態外殼（標題、隱私聲明 TUN-83、版面骨架），互動部分包在 `<ClientOnly>`：

  ```vue
  <ClientOnly>
    <TunerPanel />
    <template #fallback><TunerSkeleton /></template>  <!-- 可直接寫在頁面內的骨架 markup -->
  </ClientOnly>
  ```

- `useTuner` 初始 `phase = { kind: 'checking' }`；`onMounted` 才呼叫 `readEnvironment()`、`checkEnvironment()`、讀 localStorage 的 mode，設定為 `idle` 或 `blocked`。即使未來拿掉 `<ClientOnly>` 也不會 hydration mismatch。
- 任何頂層 `window` / `navigator` 存取都禁止；`audioGraph.ts` 只在函式內存取全域，並以 `if (!import.meta.client) throw` 防呆。
- 不使用 `routeRules: { '/tuner': { ssr: false } }`：外殼 SSR 對首屏與 SEO 有幫助，且 `<ClientOnly>` 已足夠隔離。

### 6.2 啟動（TUN-51，iOS 手勢規則）

`start()` 在 click handler 中被呼叫，**await 之前**同步完成：

```ts
function start() {
  const token = ++startToken
  phase.value = { kind: 'starting' }
  const ctx = (audioCtx ??= new (getAudioContextCtor()!)())  // 同步建立（手勢內）
  const resumeP = ctx.resume()                                // 同步呼叫（手勢內）
  const streamP = navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS)  // 同步呼叫（手勢內）
  return finishStart(token, ctx, resumeP, streamP)            // 之後才 await
}
```

`finishStart`：
1. `await streamP`；失敗 → `classifyStartError` → `phase = error`（並 `detectInAppBrowser`）。
2. 若 `token !== startToken`（使用者已離開或按停止）→ 立刻 `stream.getTracks().forEach(t => t.stop())` 後返回。這個**競態保護**是必要的：權限對話框開著時使用者可能切走頁面。
3. `await resumeP.catch(() => {})`；若 `ctx.state !== 'running'` 再試一次 `resume()`；仍不行 → `teardown()` + `phase = paused('interrupted')`（顯示「點一下繼續」，下一次點擊又是手勢）。
4. `pipeline = createTunerPipeline({ sampleRate: ctx.sampleRate, mode })`；`mic = connectMicrophone(ctx, stream, pipeline.windowSize)`。
5. 監聽 `track.onended`（裝置被拔除/被其他 App 搶走）→ `teardown()` + `paused('track-ended')`；`ctx.onstatechange`：運行中變成 `suspended` / `interrupted`（iOS 來電）→ `teardown()` + `paused('interrupted')`。
6. `phase = running`，啟動 rAF 迴圈。

### 6.3 釋放（TUN-60/61/62/63）

`teardown()` 冪等，順序：

1. `cancelAnimationFrame(rafId)`
2. 停止參考音 handle
3. `mic.release()` → `source.disconnect()`、每個 `track.stop()`（麥克風指示燈依賴這一步）
4. `audioCtx.close()`（catch 錯誤）並設為 `null`
5. 移除 `track` / `ctx` 監聽；pipeline dispatch `suspend`

觸發點：

| 事件 | 動作 |
|------|------|
| `onBeforeUnmount`（離開路由） | `teardown()`，移除 document/window 監聽 |
| `document.visibilitychange` → `hidden` | `teardown()`，`phase = paused('hidden')`（僅在 running/starting 時） |
| `window.pagehide`（iOS bfcache、關分頁） | `teardown()` |
| 回到前景 `visible` | **什麼都不做**，維持「調音已暫停，點一下繼續」；點擊 → `start()` |
| 使用者按停止 | `teardown()` → `idle` |

參考音在 `idle` / `error` / `blocked` 狀態下也要能播（TUN-93）：`toggleReference` 若 `audioCtx` 為 null 就在點擊中同步建立一個（不開麥克風）。之後若使用者按「開始調音」則沿用同一個 context。`blocked('unsupported')` 且 `audioOutputAvailable === false` 時隱藏參考音（TUN-57）。

### 6.4 localStorage（TUN-15、TUN-82）

只有 `TUNER_MODE_STORAGE_KEY` 一個 key，讀寫都包 try/catch（Safari 私密模式等會丟例外）。不存任何頻率、cents 或音訊。

---

## 7. 錯誤狀態對應

判斷順序固定：`checkEnvironment`（secure → 支援）在 `onMounted`；權限錯誤在 `start()` 之後。

| 條件 | 來源 | `phase` | UI | TUN |
|------|------|---------|----|-----|
| 首次進入 | onMounted 且環境 ok | `idle` | `TunerStartCard`（說明 + 開始按鈕）+ 參考音；**不**呼叫 getUserMedia | 50 |
| 點擊開始 | `start()` | `starting` | 「正在開啟麥克風…」，按鈕 disabled | 51 |
| 授權成功 | | `running` | `TunerMeter` 等待中 | 52 |
| `window.isSecureContext === false` | `checkEnvironment` | `blocked('insecure')` | 不顯示開始按鈕；非安全連線文案 + 參考音 | 56 |
| 無 `navigator.mediaDevices?.getUserMedia` 或無 `AudioContext`/`webkitAudioContext` | `checkEnvironment` | `blocked('unsupported', audioOutputAvailable)` | 不支援文案；`audioOutputAvailable=false` 時連參考音都隱藏並說明 | 57 |
| `NotAllowedError`、`SecurityError`（含使用者關閉對話框、permissions policy 阻擋） | `classifyStartError` | `error('permission-denied')` | 拒絕文案 + 依 `permissionPlatform(ua)` 顯示 iOS / Android / 桌面步驟 + 再試一次 + 參考音 | 53 |
| `NotFoundError`、`OverconstrainedError` | | `error('not-found')` | 找不到麥克風 + 再試一次 + 參考音 | 54 |
| `NotReadableError`、`AbortError` | | `error('not-readable')` | 麥克風被佔用 + 再試一次 + 參考音 | 55 |
| 其他（含 `TypeError`） | | `error('unknown')` | 未知錯誤文案；`console.warn(error.name)`，不送任何資料 | 59 |
| 以上任一失敗（error / blocked）且 UA 為 LINE / Instagram / Facebook | `detectInAppBrowser` | 同上 + `inAppBrowser` | 在錯誤文案下方加「用瀏覽器開啟」提示；**不預先封鎖** | 58 |
| 切背景 / 來電 / track 結束 | 生命週期 | `paused(reason)` | 「調音已暫停，點一下繼續」 | 61、62 |

「再試一次」= 再呼叫 `start()`（同樣在 click 中）；若瀏覽器記住拒絕，會立即再次 `NotAllowedError`，維持同畫面（TUN-53）。

---

## 8. 測試策略

### 8.1 工具與設定

- 現有 `npm test`（Vitest，Node 環境，`tests/**/*.spec.ts`）不變，U/F 測試全部在 Node 跑。
- 新增 devDependencies：`@vue/test-utils`、`happy-dom`、`@vitejs/plugin-vue`。`vitest.config.ts` 加上 `plugins: [vue()]`；C 測試檔頂端加 `// @vitest-environment happy-dom`。
- 測試輔助（`tests/helpers/`）：

| 檔案 | 內容 |
|------|------|
| `prng.ts` | `mulberry32(seed)`，所有雜訊與隨機相位都用固定種子（測試可重現） |
| `signals.ts` | `sine(freq, sr, durS, amp)`；`pluck(freq, sr, durS, { harmonics, decayS, phases })`（加總泛音 + 指數衰減）；`steppedSine(segments, sr)`（相位連續的頻率階躍）；`withNoise(sig, snrDb, seed)`（相對訊號 RMS 的白雜訊）；`whiteNoise(sr, durS, dbfs, seed)`；`clip(sig, level)`；`silence(sr, durS)`；`concat(...)` |
| `offline.ts` | `runOffline(signal, sr, opts?)`：以 hop = round(sr/60) 切 W 長度視窗，`now = startSample / sr * 1000`，餵 `createTunerPipeline`；回傳每幀 `{ t, analysis, state, view }` |
| `frames.ts` | 建構 `FrameAnalysis` 時間序列（`pitchedAt(freqOrCents, string)`、`silentFrames(ms)`），給 reducer 測試直接用，不經過音訊 |
| `nsdfReference.ts` | 直接 O(W·τ) 的 NSDF，驗證 FFT 版結果一致 |
| `wav.ts` | 讀 PCM16 / Float32 單聲道 WAV（fixtures 用），約 40 行 |
| `fakeAudio.ts` | `FakeAudioContext`（`state`、`sampleRate`、`resume/close` spy、`createAnalyser` 回傳可餵資料的 fake、`createOscillator`、`createPeriodicWave`）、`FakeMediaStream`/`FakeTrack`（`stop` spy、可觸發 `ended`）、`installMediaDevices({ getUserMedia })`、`setSecureContext(bool)`、`setVisibility('hidden')` |

合成「撥弦」標準訊號（TUN-23 (b)）：泛音振幅 `[0.3, 1.0, 0.7, 0.5, 0.35, 0.25]`（基頻 0.3 < 第 2 泛音 1.0），各泛音隨機相位（固定種子），整體衰減時間常數 1.5 s，前 5 ms 線性 attack。

### 8.2 測試案例 ↔ TUN

| 檔案 | 案例 | TUN |
|------|------|-----|
| `tests/tuner/strings.spec.ts` | `TUNER_STRINGS` 頻率對 PRD 表誤差 < 0.01 Hz；`label`、`stringNumber` 正確 | 01 |
| | `centsBetween(110, 110) = 0`、`(111, 110) ≈ +15.7`、`(82, 82.41) ≈ −8.6`（±0.05） | 02 |
| | `nearestStringIndex`：94 → 0（E2）、96 → 1（A2）、220 → 3（G3）；`sqrt(fE2·fA2)` 恰好交界 → 0（取較低） | 10 |
| | 自動模式在 E2/A2 交界的 cents 最大約 ±250 | 14 |
| | `parseStoredMode` 壞 JSON / 錯版本 / 越界 index → null | 15 |
| `tests/tuner/fft.spec.ts` | FFT→IFFT 還原誤差 < 1e-9；FFT 版 NSDF 與 `nsdfReference` 一致（< 1e-6） | 23（基礎） |
| `tests/tuner/pitchDetector.spec.ts` | 6 弦 × {−30, −10, 0, +10, +30} cents × {正弦, 撥弦} × {44.1k, 48k} = 120 案例（`it.each`）：跳過前 60 ms 後，**每一幀**估計誤差 ≤ ±1 cent | 23 |
| | 65 Hz、460 Hz 正弦 → `null`；72 Hz、440 Hz → 有值且誤差 ≤ 1 cent（兩種取樣率） | 22 |
| | 第 6 弦「基頻弱」撥弦（基頻振幅 0.1、0.2、0.3 三組）：不得出現 ≈ ±1200 / ±1902 cents 的估計 | 25（合成代理） |
| | 削波：撥弦訊號硬削波在峰值 30% → 誤差 ≤ ±2 cents、無八度錯誤 | 25（穩健性） |
| | 撥弦 + 白雜訊 SNR 20 dB → 誤差 ≤ ±2 cents（每幀）、無八度錯誤 | 26（合成代理） |
| | 96 kHz 一組（`windowSizeFor` = 4096）抽測 E2/E4 | 23 |
| `tests/tuner/frameAnalysis.spec.ts` | 全零 → `silent`；−60 dBFS 白雜訊 → `silent`；−30 dBFS 白雜訊 → `unclear('low-clarity' \| 'no-pitch')` | 33、34 |
| | 閘門遲滯：−51 dBFS 在 `gateWasOpen=false` 為 silent、`true` 為非 silent | 33 |
| `tests/tuner/tunerMachine.spec.ts`（只用 `frames.ts` 合成序列） | 3 筆估計相差 30 cents → 不產生讀數；第 3 筆一致後才有讀數 | 34 |
| | 有讀數後插入 unclear 幀 → `reading` 不變 | 34 |
| | 自動模式：95.0/95.3/95.0/95.4 Hz 交替（跨 95.21 交界、穩定性內）重複 2 s → 目標弦不切換；之後連續 ≥ 3 筆且 ≥ 100 ms 的 96.5 Hz → 切到 A2 | 11 |
| | 從等待中第一筆讀數 → 立即採用最近弦 | 10、11 |
| | 手動模式（A2）餵 82 Hz → 永遠相對 A2，cents ≈ −508.6（1200·log2(82/110)），status `farLow` | 12、13 |
| | `displayCents` 恆為 +4，0–499 ms 為 `approaching`，500 ms 起 `inTune` | 30、32 |
| | +5 進入計時中出現一筆 +6 → 計時重置 | 30 |
| | 進入 inTune 後 +7 持續 1 s → 維持 inTune；+8 持續 190 ms 再回 +3 → 維持；+8 持續 200 ms → 退出 | 31 |
| | inTune 後轉為 silent → 1.5 s 內仍 inTune 且 `signal='holding'`；1.5 s 後 `waiting`、tune 重置 | 31、35 |
| | 閘門開但 unclear 連續 2.0 s → `noisyHint=false`；2.01 s → `true`；有效讀數出現 → `false` | 36 |
| | `suspend` → 回到 waiting，mode 保留 | 92 |
| | 捨入：cents = −5.5 → displayCents = −6（對稱）；+5.5 → +6；−0.4 → 0（非 −0） | 30、42 |
| `tests/tuner/tunerView.spec.ts` | `formatCents(-12) = '−12 ¢'`（U+2212）、`(3) = '+3 ¢'`、`(0) = '0 ¢'`；`formatFrequency(109.63) = '109.6 Hz'` | 42、44 |
| | `needlePosition(±180) = ±1`；`(25) = 0.5` | 13、14 |
| | 方向文字：−6 → 太低轉緊、+6 → 太高轉鬆、手動 −180 → 「差很多，請繼續轉緊」 | 13、42 |
| | `announcement` 在連續讀數（數字變化）間不變，只在 waiting/讀數/準了轉換時改變 | 45 |
| `tests/tuner/pipeline.spec.ts`（`runOffline`，F 類合成） | 200 ms 靜音 + A2 撥弦：從第一個 gate-open 幀到第一個有讀數的狀態 ≤ 150 ms（44.1k、48k） | 20（F） |
| | 1 s 穩定撥弦：讀數更新 ≥ 10 次/秒（實際約 60） | 21 |
| | 合成穩定音 + SNR 20 dB：任意 1 s 視窗內 `displayCents` 標準差 ≤ 1 | 38 |
| | `steppedSine`：−20 cents 1 s → 0 cents：階躍後 300 ms 內 `|displayCents| ≤ 2` | 38 |
| | 3 s 靜音 → 0 個讀數；3 s −60 dBFS 白雜訊 → 0 個讀數 | 33 |
| | 穩定 0 cents 撥弦 → 0.5 s 後 inTune；整段只算一次 `approaching → inTune` | 30 |
| `tests/tuner/fixtures.spec.ts`（F 類，真實錄音，M0 產出後啟用） | 每段吉他錄音：穩定段中位數對 `labels.json` ≤ ±3 cents | 24 |
| | 所有吉他 fixtures：無 ±1200 cents、無錯弦估計 | 25 |
| | 吉他 + 電視/人聲 SNR 10 dB：≤ ±5 cents、無八度錯誤 | 26 |
| | 安靜房間 30 s → 0 次讀數 | 33 |
| | 說話 + 電視各 30 s：從未 `inTune`，有讀數幀占比 ≤ 10% | 37 |
| `tests/tuner/environment.spec.ts` | `checkEnvironment`：insecure 優先於 unsupported；無 AudioContext 時 `audioOutputAvailable=false` | 56、57 |
| | `classifyStartError`：各 `DOMException.name` 對應（含非 Error 物件 → unknown） | 53–55、59 |
| | `detectInAppBrowser`：LINE / Instagram / Facebook iOS、Android UA 樣本 → 對應值；iOS Safari、Android Chrome → null | 58 |
| `tests/tuner/referenceTone.spec.ts` | 每弦 `plan.frequency === TUNER_STRINGS[i].frequency`；1200·log2 誤差 ≤ 0.5；fadeIn/fadeOut ≥ 0.02 s；duration ≈ 2 | 90 |
| `tests/tuner/purity.spec.ts`（靜態掃描） | `app/` 原始碼不得出現 `MediaRecorder` | 80 |
| | `app/utils/tuner/**` 不得 import `vue` / `#imports` / `#app`，不得出現 `window.`、`navigator.`、`document.`、`localStorage` | 架構規則 |
| | `app/**` 不得出現 `82.41`、`146.83`、`196.00`、`246.94`、`329.63` 字面值（`110` 太常見不列） | 01 |
| `tests/components/useTuner.spec.ts`（C，happy-dom + fakeAudio） | 掛載後未呼叫 `getUserMedia`；`phase` 由 checking → idle | 50 |
| | `start()` 時 `AudioContext` 建構與 `getUserMedia` 都在第一個 await 前被同步呼叫 | 51 |
| | `getUserMedia` constraints 含三個 `false` | 27 |
| | mock 依序拋出 NotAllowed / NotFound / Overconstrained / NotReadable / Abort / TypeError → 對應 phase | 53–55、59 |
| | `isSecureContext=false` → `blocked('insecure')`，且從未存取 `navigator.mediaDevices` | 56 |
| | 無 mediaDevices / 無 AudioContext → `blocked('unsupported')` 及 `audioOutputAvailable` | 57 |
| | 卸載 → 每個 track `stop()`、`ctx.close()`、`cancelAnimationFrame` 被呼叫；document 監聽已移除 | 60 |
| | `visibilitychange` hidden → 同上，phase = `paused('hidden')`；回到 visible 不自動 `getUserMedia` | 61、62 |
| | `ctx.state` 變 `interrupted` / track `ended` → `paused` | 62 |
| | getUserMedia pending 時卸載 → resolve 後 track 立即 `stop()`（競態） | 60 |
| | `selectString` 只寫入 `TUNER_MODE_STORAGE_KEY`；`localStorage.setItem` spy 無其他 key；重新掛載讀回模式 | 15、82 |
| | `toggleReference`：同弦再按停止、他弦切換（同時最多一個 oscillator）；播放中 pipeline 不被呼叫、view 顯示播放中；結束後恢復 | 91、92 |
| | error / idle / blocked(insecure) 下 `toggleReference` 可播放 | 93 |
| `tests/components/TunerPanel.spec.ts`（C） | 各 phase 顯示 `tunerCopy` 對應文案；error 時有「再試一次」與參考音；inApp UA 時多一行提示 | 50–59 |
| | `TunerMeter`：inTune 同時有 `.is-in-tune`、打勾 SVG、文字「準了」；approaching 不帶綠色 class | 32、43 |
| | `aria-live` 節點文字只在狀態類別改變時變更 | 45 |
| | 選弦列 6 顆 + 自動；手動時顯示「手動」標記 | 41、12 |
| | 頁尾隱私聲明、參考音靜音提示存在 | 83、94 |

純 M 項（TUN-03、20 實機、46、63、81、TUN-53 實際恢復步驟、iOS 參考音路由）依 PRD §5.1.8 矩陣執行，不在本文件重複。開發版在 `useTuner` 內以 `performance.mark('tuner:onset')`（第一個 gate-open 幀）與 `performance.mark('tuner:first-reading')`（view 第一次有讀數後的 `nextTick`）支援 TUN-20 量測，production build 以 `import.meta.dev` 去除。

### 8.3 Fixtures 管理

- 位置：`tests/fixtures/audio/*.wav` + `tests/fixtures/audio/labels.json`（`{ file, string, expectedFreq?, kind: 'guitar' | 'noise' | 'mix' }`）。
- 建議 16-bit 單聲道 WAV、44.1 或 48 kHz，總量控制在 30 MB 內；若更大改用 Git LFS。
- M0 完成前 `fixtures.spec.ts` 以 `describe.skipIf(!existsSync(dir))` 跳過，但 **M0 Success Gate 要求它不被跳過**：在 CI 加環境變數 `REQUIRE_TUNER_FIXTURES=1` 時缺檔即失敗。

---

## 9. 架構決策紀錄（ADR）

### ADR-001：音高偵測採用 MPM（FFT 計算 NSDF）+ 拋物線內插 + 子八度檢查

**Status**: Proposed

**背景**
TUN-20 要求首讀數 ≤ 300 ms，TUN-23 要求合成訊號 ±1 cent，TUN-25 要求八度誤判 = 0（第 6 弦基頻弱、泛音強），偵測下限 70 Hz（週期 686 samples @48k），還要在中階 Android 主執行緒上跑（NFR ≥ 30 fps）。PRD Open Question 要求決定自寫或用函式庫。

**決策**
- 自行實作 MPM（約 200 行，含 FFT），不引入函式庫（bundle ≤ 50 KB、可控 octave guard、測試可看到內部）。
- 視窗 W = `windowSizeFor(sr)`（≤ 48 kHz 為 2048），NSDF 以 2W 點 FFT 計算。
- 選峰 k = 0.93；選中峰在 τmin 以下視為超出範圍回傳 null（不跳過）；拋物線內插；m ∈ {2,3} 子八度檢查（margin 0.01，原 0.05；範圍判斷移到子八度檢查之後）。
- clarity 門檻 0.9（PRD 選項之一）。
- 偵測前做 5 kHz 零相位雙二階低通（實作時新增，`lowpassHz`；理由與量測見 §2.4 第 1a 步）。

**後果**
- 容易：clarity 直接對應 PRD 參數；單一 `detect()` 介面，離線/瀏覽器共用；每幀 < 1 ms。
- 困難：需要自己維護 FFT 與 peak picking 邊界條件；`mpmK`、`octaveGuardMargin` 需 M0 真實錄音校準，校準前合成測試只能部分代表真實吉他（弦的非諧和性、琴身共鳴）。
- 風險：若第 6 弦仍有八度誤判，依序調整：(1) margin / k，(2) W 改 4096（+43 ms），(3) 改用 YIN（同一 FFT 基礎）。

**替代方案**
- **YIN**：精度與抗八度能力相近，作為第一備案；不選是因為需另外換算可信度、短視窗下 MPM 較有利。
- **FFT + HPS**：W=2048 時頻率解析度 23 Hz，±1 cent 與 300 ms 不可兼得。
- **純 ACF**：未正規化，峰值偏向小 lag、門檻依音量而變，八度錯誤多。
- **現成函式庫（如 pitchy、pitchfinder）**：可縮短 M0，但 octave guard、範圍規則與零配置需求仍要包一層；若 M0 時程吃緊，可用來做對照基準，不進正式 bundle。

### ADR-002：在主執行緒以 AnalyserNode + requestAnimationFrame 輪詢分析，不用 AudioWorklet / Web Worker

**Status**: Proposed

**背景**
需支援 iOS 16.4+ Safari、Android Chrome、桌面瀏覽器；Nuxt 4 / Vite 打包；分析成本經 FFT 化後 ≤ 1 ms/幀；讀數需 ≥ 10 次/秒；轉接層只做 C/M 測試，越薄越好。

**決策**
`MediaStreamAudioSourceNode → AnalyserNode(fftSize = W)`，在 rAF 中（最小間隔 15 ms，約 60 次/秒）呼叫 `getFloatTimeDomainData` 取最新 W 個樣本，交給 `pipeline.process`。不使用 AudioWorklet，也不使用 Web Worker。

**後果**
- 容易：零額外打包設定、SSR 無影響、fake 只需模擬 `getFloatTimeDomainData`；與畫面更新同步，沒有多餘讀數。
- 困難：幀間樣本可能重疊或漏掉（調音器不在乎）；分析與 UI 共用主執行緒；rAF 在背景停止（剛好與 TUN-61 一致）。
- 重新評估的觸發條件：目標裝置上 Performance 面板顯示 tuner 每幀分析 > 4 ms 或掉到 < 30 fps → 先把 `pipeline` 移進 Web Worker（介面不變），仍不足才評估 AudioWorklet。

**替代方案**
- **AudioWorklet 收樣本 + 主執行緒/Worker 分析**：樣本連續、時間戳精準；但處理器需獨立模組 URL，Vite dev 與 build 行為不同（`?worker&url`、dev client 注入）、TS 需另外處理、需額外實機驗證 Safari；換來的好處對調音器不明顯。
- **在 Worklet 內分析**：會在音訊執行緒做 FFT，造成 glitch。
- **ScriptProcessorNode**：已棄用。
- **AnalyserNode + Web Worker**：目前成本下沒有可量測收益，保留為第一個升級路徑。

### ADR-003：純演算法放 `app/utils/tuner/`，以規則與掃描測試保證框架無關

**Status**: Proposed

**背景**
PRD §7 要求音高對應、偵測核心、狀態機可在 Node 測試；Nuxt 4 有 `app/utils/`（auto-import 第一層）與 `shared/`（app/server 共用）兩種放法；現有測試 alias 只有 `~ → app/`。

**決策**
放 `app/utils/tuner/`（子目錄，不被 auto-import），所有使用處明確 import。禁止這些檔案 import `vue` / `#imports` / 存取瀏覽器全域，以 `tests/tuner/purity.spec.ts` 掃描強制。頻率一律由 `STANDARD_TUNING` 經 `midiToFrequency` 計算；`midiToFrequency` 等通用函式加到 `app/utils/music.ts`。

**後果**
- 容易：不改 vitest alias；不讓 server 端誤用；auto-import 不被污染。
- 困難：子目錄 import 路徑較長；需要掃描測試維持純度（目錄名稱本身不強制任何事）。

**替代方案**
- **`shared/tuner/`**：語意上表示 server 可用，與「音訊不離開裝置」相違；且需新增 alias。
- **全部寫在 composable 內**：無法在 Node 測試，違反 PRD §7。
- **Nuxt layer / 獨立 package**：一個頁面的功能不值得這層邊界。

### ADR-004：調音邏輯以純函式 reducer 實作，時間由外部注入，平滑在對數音高域

**Status**: Proposed

**背景**
TUN-11/30/31/32/34/35/36/38 都是「時間 + 序列」相關規則，PRD 要求以時間序列做 U 測試；平滑、遲滯與保留彼此互動，散落在元件或 watcher 中會難以測試。

**決策**
`tunerReducer(state, event, params)` 為純函式，`now` 由事件帶入；處理順序固定（穩定性 → 平滑 → 選弦 → 捨入 → 準了遲滯 → 保留 → 吵雜提示）。平滑在 MIDI 浮點域（中位數 5 + 時間常數 80 ms 的 EMA，跳動 > 50 cents 重置）；`displayCents` 用對稱捨入，「準了」判定與畫面使用同一個整數。`selectTunerView` 把 state 轉成 UI 需要的字串與數值。

**後果**
- 容易：所有 TUN 時間規則可用合成序列確定性測試；UI 元件幾乎無邏輯；參數集中。
- 困難：state 物件欄位較多（含內部欄位）；每幀建立新物件（可接受，約 60 次/秒的小物件）。

**替代方案**
- **XState 等狀態機函式庫**：可視化好，但增加 bundle 與學習成本，規則數量不需要。
- **Vue watcher + setTimeout 實作計時**：計時器與 rAF 交錯難測，實機行為與測試不一致。
- **在 Hz 或 cents（對目標弦）域平滑**：換弦時需重置，Hz 域的平均在高低音不等價。

### ADR-005：單一 AudioContext 擁有者，手勢內啟動，離開/切背景完整釋放，不自動重啟

**Status**: Proposed

**背景**
iOS Safari 要求使用者手勢才能啟動音訊；TUN-60～63 要求離開或切背景時麥克風指示 ≤ 1 秒消失、回前景不自動重啟；參考音需在無麥克風時可用、且與偵測互斥（TUN-92/93）；iOS 對同時存在的 AudioContext 數量與音訊 session 有限制。

**決策**
- `useTuner` 是唯一擁有 `AudioContext`、`MediaStream`、rAF 的地方；參考音與麥克風共用同一個 context。
- `start()` 在 click 中同步呼叫 `new AudioContext()`、`resume()`、`getUserMedia()`，之後才 await；以 `startToken` 處理「權限對話框期間離開」的競態。
- `teardown()` 冪等：停 rAF → 停參考音 → disconnect + `track.stop()` → `ctx.close()`；在 `onBeforeUnmount`、`visibilitychange:hidden`、`pagehide`、`ctx` 被中斷、`track.ended` 時觸發。
- 回前景只顯示「點一下繼續」。
- `useTuner` 不暴露 `AudioContext`。

**後果**
- 容易：資源釋放路徑只有一條，C 測試一次涵蓋；不會有兩個 context 搶 iOS 音訊 session。
- 困難：每次恢復都要重新取得權限串流（多數瀏覽器記住授權，不會再跳對話框）；`useTuner` 檔案較大，需靠 `audioGraph.ts` 拆出瀏覽器細節。

**替代方案**
- **`suspend()` 而非 `close()` 並保留 stream**：恢復較快，但麥克風指示燈不會熄滅，違反 TUN-61/63 與隱私承諾。
- **參考音獨立 composable 與 context**：模組更獨立，但 iOS 上兩個 context 與錄音 session 互動難預測。
- **回前景自動重啟**：iOS 沒有手勢會失敗，且違反 TUN-62。

### ADR-006：元件測試用 @vue/test-utils + happy-dom，不引入 @nuxt/test-utils

**Status**: Proposed

**背景**
PRD 的 C 類測試需要 mock `navigator.mediaDevices` / `AudioContext` 驗證 composable 與 UI 狀態；專案只有 Vitest 純邏輯測試，未裝 `@nuxt/test-utils`。

**決策**
新增 `@vue/test-utils`、`happy-dom`、`@vitejs/plugin-vue`。tuner 的 composable 與元件**明確 import** `vue` API、子元件與 utils（不依賴 Nuxt auto-import），因此可直接 `mount()`。`TunerPanel` 不使用 Nuxt 專屬 composable（`useSeoMeta` 等只放在 `pages/tuner.vue`）。

**後果**
- 容易：測試快、設定少、無 Nuxt runtime 啟動成本；fake 完全受控。
- 困難：無法在 C 測試涵蓋 `pages/tuner.vue` 的 `<ClientOnly>` 與路由；需團隊遵守「tuner 檔案明確 import」約定（code review）。
- 若未來要做 E2E / 路由層測試，再引入 `@nuxt/test-utils` + Playwright，兩者可共存。

**替代方案**
- **`@nuxt/test-utils`（`mountSuspended`）**：auto-import 可用、更接近真實；但設定與執行時間較重，對本功能的收益僅在頁面層。
- **只做 M 測試**：PRD 明確要求 C 類，且錯誤狀態難以在實機重現。

### ADR-007：參考音使用含泛音的 PeriodicWave，頻率等於目標頻率

**Status**: Proposed

**背景**
TUN-90 要求頻率誤差 ≤ 0.5 cent、約 2 秒、≥ 20 ms 淡入淡出。手機喇叭對 200 Hz 以下輸出極弱，82 Hz 純正弦在多數手機幾乎聽不到，無法拿來用耳朵對音。

**決策**
`OscillatorNode.setPeriodicWave(createPeriodicWave(harmonics))`，`frequency.value = TUNER_STRINGS[i].frequency`；泛音係數 `[0, 1, 0.6, 0.4, 0.25, 0.15, 0.1]`；`GainNode` 以 `linearRampToValueAtTime` 做 30 ms 淡入 / 80 ms 淡出。播放時 `useTuner` 暫停分析並 dispatch `suspend`。

**後果**
- 容易：低音弦在手機喇叭上可聽見（聽覺會由泛音推出基頻）；頻率精度與純正弦相同，TUN-90 照樣可測。
- 困難：音色較「電子」；M1 需實機確認音量與 iOS 錄音 session 下的路由。

**替代方案**
- **純正弦**：最簡單，但低音弦在手機上近乎無聲。
- **預錄吉他取樣**：最自然，但增加資產大小，且要確保錄音本身 ±0.5 cent。
- **Karplus-Strong 合成**：像撥弦，但需要 worklet 或預先算 buffer，MVP 不值得。

---

## 10. 需要 PM 確認的 PRD 落差

> **狀態（2026-10-28）**：以下 6 點都已在 PRD v0.3 同步（TUN-11、§5.1.11 參數表），實作採用本文件的預設設計。PM 若不同意，改 `params.ts` 對應參數即可。

1. **TUN-11「連續 ≥ 3 次（約 ≥ 100 ms）」與 §5.1.11「hop ≤ 1024 samples」不一致**：hop ≤ 1024 @48k 代表 ≥ 47 次/秒，3 次只有約 64 ms（本設計約 60 次/秒，3 次 ≈ 50 ms）。本設計同時要求「≥ 3 次**且** ≥ 100 ms」（`autoSwitchMinMs`），兩個條件都滿足。若 PM 只要次數，把參數設 0。
2. **雜訊閘門遲滯**（open −50 / close −53 dBFS）為新增參數，PRD 只有單一門檻。設為相同值即回到 PRD 原意。
3. **TUN-34 的「訊號不清」持續很久時要不要回到等待中**未定義：本設計套用與 TUN-35 相同的 1.5 s 保留，之後回到等待中，同時 TUN-36 的吵雜提示在 2 s 出現。
4. **§5.1.11 清晰度門檻**：依選定演算法定為 MPM clarity ≥ 0.9，PRD 表格可刪除 YIN 那半句。
5. **TUN-90 參考音波形**：PRD 未規定波形，本設計用含泛音的波形（ADR-007），頻率規格不變。
6. 新增參數 `mpmK`、`octaveGuardMargin`、`emaTimeConstantMs`、`medianSize`、`resetJumpCents`、`inTuneMaxGapMs`、`minAnalysisIntervalMs`，建議補進 §5.1.11 表格。

---

## 11. 實作順序建議（對齊 M0 / M1）

1. `music.ts` 新增函式 → `strings.ts` + 測試（TUN-01/02/10/14）。
2. `fft.ts` → `pitchDetector.ts` + 合成訊號測試（TUN-22/23、八度、削波、雜訊）。**M0 第一個可驗證點。**
3. `frameAnalysis.ts` → `tunerMachine.ts` → `tunerView.ts` + 時間序列測試。
4. `pipeline.ts` + `tests/helpers/offline.ts` + pipeline 測試（TUN-20F/21/33/38）。
5. 並行：fixtures 錄製與標註 → `fixtures.spec.ts`，校準 `params.ts`（M0 Gate）。
6. `environment.ts`、`referenceTone.ts`、`tuner-copy.ts` + 測試。
7. `audioGraph.ts` → `useTuner.ts` + `fakeAudio.ts` + C 測試（TUN-50～62、90～93）。
8. 元件與 `pages/tuner.vue`，首頁/練習頁入口（P0-3），實機矩陣（M1）。
