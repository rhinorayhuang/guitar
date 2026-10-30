<script setup lang="ts">
import { tunerCopy } from '~/data/tuner-copy'

defineProps<{ starting: boolean }>()
const emit = defineEmits<{ start: [] }>()
</script>

<template>
  <div class="card" data-testid="tuner-start-card">
    <h2>{{ tunerCopy.intro.title }}</h2>
    <p>{{ tunerCopy.intro.body }}</p>
    <!-- click 必須直接呼叫 start()，中間不得有 await（iOS 手勢規則，TUN-51） -->
    <button type="button" class="primary" :disabled="starting" data-testid="tuner-start" @click="emit('start')">
      {{ starting ? tunerCopy.starting : tunerCopy.intro.startButton }}
    </button>
  </div>
</template>

<style scoped>
.card { text-align: center; }
h2 { margin: 0 0 8px; font-size: 1.25rem; }
p { margin: 0 0 16px; color: var(--fg-muted); }
.primary {
  min-height: 48px; min-width: 160px; padding: 10px 24px;
  border: none; border-radius: 12px; background: var(--accent); color: #fff;
  font: inherit; font-weight: 700; cursor: pointer;
}
.primary:disabled { opacity: 0.6; cursor: progress; }
.primary:focus-visible { outline: 2px solid var(--fg); outline-offset: 2px; }
</style>
