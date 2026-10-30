<script setup lang="ts">
import { computed } from 'vue'
import MetronomeBeatIndicator from '~/components/metronome/MetronomeBeatIndicator.vue'
import MetronomeBpmControl from '~/components/metronome/MetronomeBpmControl.vue'
import type { UseMetronome } from '~/composables/useMetronome'
import { metronomeCopy } from '~/data/metronome-copy'

// ADR-012：頁面擁有 useMetronome 實例，以 prop 傳入（不用 provide/inject）
const props = defineProps<{
  metronome: UseMetronome
  /** 例如「第 3 關目標速度」；純顯示 */
  label?: string | null
}>()
const emit = defineEmits<{ 'manual-change': [] }>()

// metronome 物件在頁面生命週期內不會被替換；解構出的是 ref，模板中自動解包
const { phase, bpm, currentBeat, isPlaying, available, beatsPerBar } = props.metronome

const playText = computed(() => {
  switch (phase.value.kind) {
    case 'starting': return metronomeCopy.starting
    case 'running': return metronomeCopy.stop
    case 'paused': return metronomeCopy.paused
    default: return metronomeCopy.start
  }
})

function onNudge(delta: number) {
  props.metronome.nudgeBpm(delta)
  emit('manual-change')
}

function onToggle() {
  // 必須在 click 中同步呼叫（iOS 手勢規則）
  void props.metronome.toggle()
}
</script>

<template>
  <section class="metronome-panel" :aria-label="metronomeCopy.title" data-testid="metronome-panel">
    <p v-if="phase.kind === 'unsupported'" class="unsupported" role="status" data-testid="metronome-unsupported">
      {{ metronomeCopy.unsupported }}
    </p>
    <template v-else>
      <p class="label" data-testid="metronome-label">
        <span class="title">{{ metronomeCopy.title }}</span>
        <span v-if="label" class="target">・{{ label }}</span>
      </p>
      <div class="row">
        <MetronomeBpmControl :bpm="bpm" :disabled="!available" @nudge="onNudge" />
        <div class="play-group">
          <MetronomeBeatIndicator :current-beat="currentBeat" :beats-per-bar="beatsPerBar" />
          <button
            type="button" :class="['play', { 'is-playing': isPlaying, 'is-paused': phase.kind === 'paused' }]"
            :disabled="!available" :aria-pressed="isPlaying" data-testid="metronome-toggle" @click="onToggle"
          >
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <rect v-if="isPlaying" x="3" y="3" width="10" height="10" rx="1" fill="currentColor" />
              <path v-else d="M4 2.5v11l9-5.5z" fill="currentColor" />
            </svg>
            <span>{{ playText }}</span>
          </button>
        </div>
      </div>
      <p class="hint" data-testid="metronome-hint">{{ metronomeCopy.silentModeHint }}</p>
    </template>
  </section>
</template>

<style scoped>
.metronome-panel { padding: 6px 0 0; }
.label { margin: 0; font-size: 0.8125rem; color: var(--fg-muted); line-height: 1.4; }
.title { color: var(--fg); font-weight: 600; }
.row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 12px; }
.play-group { display: flex; align-items: center; gap: 12px; margin-left: auto; }
.play {
  display: inline-flex; align-items: center; gap: 6px; min-height: 44px; min-width: 44px; padding: 8px 16px;
  border: none; border-radius: 10px; background: var(--accent); color: var(--bg);
  font: inherit; font-weight: 600; cursor: pointer;
}
.play.is-playing { background: transparent; color: var(--fg); border: 1px solid var(--border); }
.play.is-paused { font-weight: 500; font-size: 0.875rem; }
.play:disabled { opacity: 0.5; cursor: not-allowed; }
.play:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.hint { margin: 2px 0 0; color: var(--fg-muted); font-size: 0.75rem; line-height: 1.4; }
.unsupported { margin: 0; padding: 12px 0; color: var(--fg-muted); }

/* 窄於 560 px 一律兩列，斷點與 practice.vue 的骨架一致，避免依內容寬度換行造成 hydration 後版面跳動（code review #3） */
@media (max-width: 559.98px) {
  .row { flex-direction: column; align-items: stretch; }
  .play-group { margin-left: 0; justify-content: flex-end; }
}

/* 窄於 360 px：BPM 控制一列、圓點＋播放一列 */
@media (max-width: 359.98px) {
  .play-group { width: 100%; justify-content: space-between; margin-left: 0; }
}
</style>
