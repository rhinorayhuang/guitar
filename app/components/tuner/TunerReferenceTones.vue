<script setup lang="ts">
import { tunerCopy } from '~/data/tuner-copy'
import { TUNER_STRINGS } from '~/utils/tuner/strings'

defineProps<{ playingIndex: number | null; disabled: boolean }>()
const emit = defineEmits<{ toggle: [index: number] }>()
</script>

<template>
  <section class="reference" aria-labelledby="reference-title" data-testid="tuner-reference">
    <h2 id="reference-title">{{ tunerCopy.referenceTitle }}</h2>
    <div class="buttons">
      <button
        v-for="s in TUNER_STRINGS"
        :key="s.index"
        type="button"
        :class="{ 'is-playing': playingIndex === s.index }"
        :disabled="disabled"
        :aria-pressed="playingIndex === s.index"
        :aria-label="`${tunerCopy.referenceTitle} ${tunerCopy.stringLabel(s.stringNumber)} ${s.label}`"
        :data-testid="`reference-${s.index}`"
        @click="emit('toggle', s.index)"
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <rect v-if="playingIndex === s.index" x="3" y="3" width="10" height="10" rx="1" fill="currentColor" />
          <path v-else d="M4 2.5v11l9-5.5z" fill="currentColor" />
        </svg>
        <span>{{ s.label }}</span>
      </button>
    </div>
    <p class="hint">{{ tunerCopy.referenceHint }}</p>
  </section>
</template>

<style scoped>
h2 { margin: 0 0 8px; font-size: 1rem; }
.buttons { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
@media (min-width: 560px) {
  .buttons { grid-template-columns: repeat(6, minmax(0, 1fr)); }
}
button {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-height: 44px; padding: 4px 8px;
  border: 1px solid var(--border); border-radius: 10px;
  background: var(--surface); color: var(--fg); font: inherit; cursor: pointer;
}
button:disabled { opacity: 0.5; cursor: not-allowed; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button.is-playing { border-color: var(--accent); color: var(--accent); font-weight: 700; }
.hint { margin: 8px 0 0; font-size: 0.8125rem; color: var(--fg-muted); }
</style>
