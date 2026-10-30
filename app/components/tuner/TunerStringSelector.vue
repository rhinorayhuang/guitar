<script setup lang="ts">
import { tunerCopy } from '~/data/tuner-copy'
import { TUNER_STRINGS, type TunerMode } from '~/utils/tuner/strings'

defineProps<{ activeIndex: number | null; mode: TunerMode }>()
const emit = defineEmits<{ select: [index: number | 'auto'] }>()

// 低音弦在左（第 6 弦 → 第 1 弦），與 TUNER_STRINGS 順序相同
</script>

<template>
  <div class="selector" role="group" aria-label="選擇要調的弦">
    <button
      type="button"
      class="auto"
      :class="{ 'is-selected': mode.kind === 'auto' }"
      :aria-pressed="mode.kind === 'auto'"
      data-testid="string-auto"
      @click="emit('select', 'auto')"
    >
      {{ tunerCopy.auto }}
    </button>
    <button
      v-for="s in TUNER_STRINGS"
      :key="s.index"
      type="button"
      class="string"
      :class="{ 'is-active': activeIndex === s.index }"
      :aria-pressed="mode.kind === 'manual' && mode.stringIndex === s.index"
      :aria-label="`${tunerCopy.stringLabel(s.stringNumber)} ${s.label}`"
      :data-testid="`string-${s.index}`"
      @click="emit('select', s.index)"
    >
      <span class="name">{{ s.name }}</span>
      <span class="num">{{ s.stringNumber }}</span>
    </button>
    <span v-if="mode.kind === 'manual'" class="manual-badge" data-testid="manual-badge">{{ tunerCopy.manual }}</span>
  </div>
</template>

<style scoped>
.selector { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 6px; }
button {
  min-width: 44px; min-height: 44px; padding: 4px 8px;
  border: 1px solid var(--border); border-radius: 10px;
  background: var(--surface); color: var(--fg); font: inherit; cursor: pointer;
}
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.string { display: flex; flex-direction: column; align-items: center; line-height: 1.1; }
.name { font-weight: 700; }
.num { font-size: 0.6875rem; color: var(--fg-muted); }
.auto.is-selected { border-color: var(--accent); color: var(--accent); font-weight: 700; }
.string.is-active { border-color: var(--accent); background: var(--accent); color: var(--bg); }
.string.is-active .num { color: inherit; }
.manual-badge { font-size: 0.75rem; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--accent); color: var(--accent); }
</style>
