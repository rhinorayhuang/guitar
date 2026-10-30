<script setup lang="ts">
import { computed } from 'vue'
import { useTuner, type TunerPhase } from '~/composables/useTuner'
import { tunerCopy } from '~/data/tuner-copy'
import TunerErrorNotice from './TunerErrorNotice.vue'
import TunerMeter from './TunerMeter.vue'
import TunerReferenceTones from './TunerReferenceTones.vue'
import TunerStartCard from './TunerStartCard.vue'
import TunerStringSelector from './TunerStringSelector.vue'

// 容器元件：唯一呼叫 useTuner() 的地方；不使用 Nuxt 專屬 composable（ADR-006）
const { phase, view, mode, referencePlaying, userAgent, start, stop, selectString, toggleReference } = useTuner()

type NoticePhase = Extract<TunerPhase, { kind: 'error' | 'blocked' | 'paused' }>
const noticePhase = computed<NoticePhase | null>(() => {
  const p = phase.value
  return p.kind === 'error' || p.kind === 'blocked' || p.kind === 'paused' ? p : null
})
const isRunning = computed(() => phase.value.kind === 'running')
// TUN-45：只綁狀態類別的文字，避免每次讀數都播報；播參考音時偵測已暫停，不播報「請撥一條空弦」
const announcement = computed(() => {
  if (!isRunning.value) return ''
  return referencePlaying.value !== null ? tunerCopy.referencePlaying : view.value.announcement
})
const showReference = computed(() =>
  phase.value.kind !== 'checking' && !(phase.value.kind === 'blocked' && !phase.value.audioOutputAvailable))
</script>

<template>
  <div class="panel" :data-phase="phase.kind" data-testid="tuner-panel">
    <div class="main card">
      <p v-if="phase.kind === 'checking'" class="muted">…</p>
      <TunerStartCard
        v-else-if="phase.kind === 'idle' || phase.kind === 'starting'"
        :starting="phase.kind === 'starting'"
        @start="start"
      />
      <TunerErrorNotice v-else-if="noticePhase" :phase="noticePhase" :user-agent="userAgent" @retry="start" />
      <template v-else-if="isRunning">
        <p v-if="referencePlaying !== null" class="banner" data-testid="reference-banner">{{ tunerCopy.referencePlaying }}</p>
        <TunerMeter :view="view" />
        <p v-if="view.noisyHint && referencePlaying === null" class="banner" data-testid="noisy-hint">{{ tunerCopy.noisy }}</p>
        <button type="button" class="secondary" data-testid="tuner-stop" @click="stop">{{ tunerCopy.stop }}</button>
      </template>
    </div>

    <div v-if="phase.kind !== 'checking'" class="card">
      <TunerStringSelector :active-index="view.string?.index ?? null" :mode="mode" @select="selectString" />
    </div>

    <div v-if="showReference" class="card">
      <TunerReferenceTones :playing-index="referencePlaying" :disabled="false" @toggle="toggleReference" />
    </div>

    <p class="visually-hidden" aria-live="polite" data-testid="tuner-announcement">{{ announcement }}</p>
  </div>
</template>

<style scoped>
.panel { display: grid; gap: 12px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
.main { min-height: 320px; display: flex; flex-direction: column; justify-content: center; }
.muted { text-align: center; color: var(--fg-muted); }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.banner { margin: 0 0 8px; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--accent); color: var(--accent); text-align: center; font-size: 0.9375rem; }
.banner:last-of-type { margin-top: 12px; }
.secondary {
  align-self: center; margin-top: 16px; min-height: 44px; padding: 8px 20px;
  border: 1px solid var(--border); border-radius: 10px; background: transparent; color: var(--fg-muted);
  font: inherit; cursor: pointer;
}
.secondary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
