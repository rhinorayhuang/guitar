<script setup lang="ts">
import { ref, watch } from 'vue'
import MetronomePanel from '~/components/metronome/MetronomePanel.vue'
import { chordById } from '~/data/chords'
import { metronomeCopy } from '~/data/metronome-copy'
import { practicePlan } from '~/data/practice-plan'
import { useMetronome } from '~/composables/useMetronome'
import { useProgress } from '~/composables/useProgress'
import { DEFAULT_BPM } from '~/utils/metronome/params'
import { currentStageId, isStageCompleted } from '~/utils/progress'

useSeoMeta({ title: '練習進度' })

const chordName = (id: string) => chordById(id)?.name ?? id

const { progress, loaded, storageNotice, setCompleted, dismissNotice, exportBackup, importFromText } = useProgress()
// 讀到 localStorage 之前不標示「目前關卡」，避免 SSR 畫面先標第 1 關再跳走
const current = computed(() => (loaded.value ? currentStageId(practicePlan, progress.value) : null))
const done = (id: string) => isStageCompleted(progress.value, id)
const doneCount = computed(() => practicePlan.filter(s => done(s.id)).length)
// P0-5：建議分鐘數跟著目前關卡；全部過關時沿用最後一關
const currentMinutes = computed(() =>
  (practicePlan.find(s => s.id === current.value) ?? practicePlan.at(loaded.value ? -1 : 0)!).dailyMinutes)

// 節拍器（ADR-012）：頁面擁有唯一的實例，以 prop 傳給底部面板。
// D-M5：不記住上次的 BPM；讀到進度後預設為目前關卡的 targetBpm，全部過關時用最後一關。
const metronome = useMetronome({ initialBpm: DEFAULT_BPM })
const metronomeStageId = ref<string | null>(null)
const metronomeLabel = computed(() => {
  const index = practicePlan.findIndex(s => s.id === metronomeStageId.value)
  return index < 0 ? null : metronomeCopy.stageTarget(index + 1)
})
watch(loaded, (isLoaded) => {
  if (!isLoaded || metronome.isPlaying.value || metronomeStageId.value !== null) return
  const stage = practicePlan.find(s => s.id === current.value) ?? practicePlan.at(-1)!
  metronome.setBpm(stage.targetBpm)
  metronomeStageId.value = stage.id
}, { immediate: true })

/** D-M1：在 click 中同步呼叫；未播放則開始，播放中只換速度 */
function practiceAt(stageId: string, targetBpm: number) {
  metronomeStageId.value = stageId
  void metronome.playAt(targetBpm)
}

// 底部常駐面板會蓋住鍵盤焦點所在的元素：捲動定位預留「實際量到的」面板高度（WCAG 2.4.11）。
// 面板高度依寬度、換行、safe area 而變，不用估計值（code review #2）
const dockEl = ref<HTMLElement | null>(null)
let dockObserver: ResizeObserver | null = null
function syncScrollPadding() {
  const h = dockEl.value?.getBoundingClientRect().height ?? 0
  document.documentElement.style.scrollPaddingBottom = `${Math.ceil(h) + 16}px`
}
onMounted(() => {
  if (!dockEl.value) return
  syncScrollPadding() // 先同步量一次：ResizeObserver 要等下一次繪製才回呼
  if (typeof ResizeObserver === 'undefined') return
  dockObserver = new ResizeObserver(syncScrollPadding)
  dockObserver.observe(dockEl.value)
})
onBeforeUnmount(() => {
  dockObserver?.disconnect()
  dockObserver = null
  document.documentElement.style.removeProperty('scroll-padding-bottom')
})
</script>

<template>
  <section>
    <h1>初學者練習進度</h1>
    <!-- P0-3：每次練習前先調音 -->
    <NuxtLink to="/tuner" class="tune-first" data-testid="tune-first">
      <span aria-hidden="true">🎵</span>
      <span><strong>先調音再練習</strong>・沒調準的琴，練得再對也會難聽</span>
      <span aria-hidden="true" class="arrow">→</span>
    </NuxtLink>
    <p v-if="loaded" class="summary" data-testid="progress-summary">
      已過關 {{ doneCount }} / {{ practicePlan.length }}
      <template v-if="current === null">・全部完成，太棒了！</template>
    </p>
    <p v-if="storageNotice" class="notice" role="status" data-testid="storage-notice">
      這個瀏覽器無法保存進度（可能是私密瀏覽模式），重新整理後過關紀錄會消失。
      <button type="button" class="link" @click="dismissNotice">知道了</button>
    </p>

    <FingerCareNotice :minutes="currentMinutes" />

    <ol class="stages">
      <li
        v-for="(stage, index) in practicePlan" :id="stage.id" :key="stage.id"
        :class="['stage', { 'is-done': done(stage.id), 'is-current': current === stage.id }]"
        :aria-current="current === stage.id ? 'step' : undefined"
      >
        <div class="stage-head">
          <h2>第 {{ index + 1 }} 關：{{ stage.title }}</h2>
          <span v-if="current === stage.id" class="badge current">目前關卡</span>
          <span v-else-if="done(stage.id)" class="badge done">✓ 已過關</span>
        </div>
        <p>
          和弦：{{ stage.chords.map(chordName).join('、') }}<br>
          轉換：{{ stage.transitions.map(([a, b]) => `${chordName(a)} ↔ ${chordName(b)}`).join('、') }}<br>
          目標 {{ stage.targetBpm }} BPM・每天 {{ stage.dailyMinutes }} 分鐘
        </p>
        <p class="completion"><strong>過關標準：</strong>{{ stage.completion }}</p>
        <ul class="tips">
          <li v-for="tip in stage.tips" :key="tip">{{ tip }}</li>
        </ul>
        <!-- PA-07：選填的「為什麼」，放在過關標準之後，不是過關條件 -->
        <aside v-if="stage.theoryNote" class="theory" :aria-label="`第 ${index + 1} 關樂理小知識`">
          <p class="theory-label">樂理小知識・看不懂也能過關</p>
          <p class="theory-body">{{ stage.theoryNote }}</p>
        </aside>

        <div class="actions">
          <!-- SSR 就輸出；onMounted 前 phase 為 checking → disabled，hydration 一致 -->
          <button
            type="button" class="secondary practice-bpm" :disabled="!metronome.available.value"
            :data-testid="`metronome-stage-${stage.id}`" @click="practiceAt(stage.id, stage.targetBpm)"
          >
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor" /></svg>
            {{ metronomeCopy.stageButton(stage.targetBpm) }}
          </button>
          <template v-if="loaded">
            <button
              v-if="!done(stage.id)" type="button" class="primary"
              :data-testid="`complete-${stage.id}`" @click="setCompleted(stage.id, true)"
            >
              我過關了
            </button>
            <button
              v-else type="button" class="secondary"
              :data-testid="`undo-${stage.id}`" @click="setCompleted(stage.id, false)"
            >
              取消過關
            </button>
          </template>
        </div>
      </li>
    </ol>

    <ProgressBackupPanel v-if="loaded" :export-backup="exportBackup" :import-from-text="importFromText" />

    <!-- D-M7：底部常駐。sticky 在文件流中佔位，捲到底時不會蓋住最後一關 -->
    <div ref="dockEl" class="metronome-dock" data-testid="metronome-dock">
      <ClientOnly>
        <MetronomePanel :metronome="metronome" :label="metronomeLabel" @manual-change="metronomeStageId = null" />
        <template #fallback>
          <div class="metronome-skeleton" aria-hidden="true" />
        </template>
      </ClientOnly>
    </div>
  </section>
</template>

<style scoped>
.tune-first {
  display: flex; align-items: center; gap: 10px; min-height: 44px; margin: 0 0 12px; padding: 10px 14px;
  border: 1px solid var(--accent); border-radius: 10px; color: var(--fg); text-decoration: none;
}
.tune-first .arrow { margin-left: auto; color: var(--accent); }
.tune-first:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.summary { color: var(--fg-muted); margin: -4px 0 16px; }
.notice { border: 1px solid var(--accent); border-radius: 8px; padding: 8px 12px; font-size: 0.9375rem; }
.link { background: none; border: none; color: var(--accent); font: inherit; text-decoration: underline; cursor: pointer; padding: 0 4px; }
.stages { list-style: none; padding: 0; display: grid; gap: 16px; }
.stage { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px 20px; scroll-margin-top: 16px; }
.stage.is-current { border-color: var(--accent); }
.stage-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 8px; }
.stage h2 { margin: 0; font-size: 1.125rem; }
.badge { font-size: 0.8125rem; border-radius: 999px; padding: 2px 10px; }
.badge.current { background: var(--accent); color: var(--bg); font-weight: 600; }
.badge.done { border: 1px solid var(--border); color: var(--fg-muted); }
.completion { border-left: 3px solid var(--accent); padding-left: 12px; }
.tips { color: var(--fg-muted); font-size: 0.875rem; }
.theory { margin-top: 12px; padding: 10px 12px; border: 1px dashed var(--border); border-radius: 8px; }
.theory-label { margin: 0 0 4px; color: var(--accent); font-size: 0.8125rem; font-weight: 600; }
.theory-body { margin: 0; font-size: 0.9375rem; line-height: 1.6; }
.actions { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px; }
.actions button { min-height: 44px; padding: 8px 18px; border-radius: 10px; font: inherit; cursor: pointer; }
.primary { background: var(--accent); color: var(--bg); border: none; font-weight: 600; }
.secondary { background: transparent; color: var(--fg-muted); border: 1px solid var(--border); }
.practice-bpm { display: inline-flex; align-items: center; gap: 6px; color: var(--fg); }
.practice-bpm:disabled { opacity: 0.5; cursor: not-allowed; }
.actions button:focus-visible, .link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.metronome-dock {
  position: sticky; bottom: 0; z-index: 10; margin-top: 16px;
  padding: 8px 0 max(8px, env(safe-area-inset-bottom));
  background: var(--surface); border-top: 1px solid var(--border);
}
/* 與面板同高的骨架，避免 hydration 後版面跳動（單列約 92 px；窄螢幕換成兩列） */
.metronome-skeleton { min-height: 92px; }
@media (max-width: 559.98px) {
  .metronome-skeleton { min-height: 136px; }
}
</style>
