<script setup lang="ts">
import { computed } from 'vue'
import { metronomeCopy } from '~/data/metronome-copy'

// §5.3–5.4：兩拍之間保持亮著；圓點與拍號只供視覺，螢幕閱讀器使用者以聲音跟拍
const props = defineProps<{ currentBeat: number | null; beatsPerBar: number }>()
const beats = computed(() => Array.from({ length: props.beatsPerBar }, (_, i) => i))
</script>

<template>
  <div class="beat-indicator" aria-hidden="true" data-testid="metronome-beats">
    <span
      v-for="i in beats" :key="i"
      :class="['dot', { 'is-active': currentBeat === i, 'is-accent': i === 0 }]"
    />
    <span class="beat-number">{{ currentBeat === null ? '' : metronomeCopy.beatLabel(currentBeat + 1) }}</span>
  </div>
</template>

<style scoped>
.beat-indicator { display: flex; align-items: center; gap: 8px; }
.dot {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid var(--fg-muted); background: transparent;
  transition: transform 120ms ease-out, background-color 120ms ease-out;
}
.dot.is-accent { width: 18px; height: 18px; border-color: var(--accent); }
.dot.is-active { background: var(--fg); border-color: var(--fg); transform: scale(1.2); }
.dot.is-accent.is-active { background: var(--accent); border-color: var(--accent); }
.beat-number { min-width: 3.5em; color: var(--fg-muted); font-size: 0.8125rem; font-variant-numeric: tabular-nums; }
/* 手機上省空間：圓點已足夠表示拍位 */
@media (max-width: 559.98px) {
  .beat-number { display: none; }
}

/* 仍切換「哪一顆實心」（資訊），只移除放大與轉場 */
@media (prefers-reduced-motion: reduce) {
  .dot { transition: none; animation: none; transform: none; }
  .dot.is-active { transform: none; }
}
</style>
