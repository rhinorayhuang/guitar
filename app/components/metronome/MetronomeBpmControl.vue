<script setup lang="ts">
import { metronomeCopy } from '~/data/metronome-copy'
import { BPM_MAX, BPM_MIN } from '~/utils/clock/tempo'
import { BPM_STEPS } from '~/utils/metronome/params'

defineProps<{ bpm: number; disabled?: boolean }>()
const emit = defineEmits<{ nudge: [delta: number] }>()

const decrements = [BPM_STEPS.coarse, BPM_STEPS.fine] as const
const increments = [BPM_STEPS.fine, BPM_STEPS.coarse] as const
</script>

<template>
  <div class="bpm-control" role="group" :aria-label="metronomeCopy.bpmUnit">
    <button
      v-for="n in decrements" :key="`-${n}`" type="button" class="step"
      :disabled="disabled || bpm <= BPM_MIN" :aria-label="metronomeCopy.decrease(n)"
      :data-testid="`metronome-minus-${n}`" @click="emit('nudge', -n)"
    >
      −{{ n }}
    </button>
    <output class="value" aria-live="polite" aria-atomic="true" data-testid="metronome-bpm">
      <span class="number">{{ bpm }}</span> <span class="unit">{{ metronomeCopy.bpmUnit }}</span>
    </output>
    <button
      v-for="n in increments" :key="`+${n}`" type="button" class="step"
      :disabled="disabled || bpm >= BPM_MAX" :aria-label="metronomeCopy.increase(n)"
      :data-testid="`metronome-plus-${n}`" @click="emit('nudge', n)"
    >
      +{{ n }}
    </button>
  </div>
</template>

<style scoped>
.bpm-control { display: flex; align-items: center; gap: 4px; }
.step {
  min-width: 44px; min-height: 44px; padding: 0 6px; border-radius: 10px;
  border: 1px solid var(--border); background: transparent; color: var(--fg);
  font: inherit; font-variant-numeric: tabular-nums; cursor: pointer;
}
.step:disabled { color: var(--fg-muted); opacity: 0.5; cursor: not-allowed; }
.step:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.value { min-width: 5.5em; text-align: center; white-space: nowrap; }
.number { font-size: 1.375rem; font-weight: 700; font-variant-numeric: tabular-nums; }
.unit { color: var(--fg-muted); font-size: 0.8125rem; }
</style>
