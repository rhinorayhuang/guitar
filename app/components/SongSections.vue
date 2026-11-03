<script setup lang="ts">
import { computed } from 'vue'
import type { SongSection } from '~/types/chord'
import { describeStrum } from '~/utils/strum'
import StrumPatternView from './StrumPatternView.vue'

const props = defineProps<{
  sections: SongSection[]
  chordName: (id: string) => string
}>()

const totalBars = computed(() => props.sections.reduce((n, s) => n + s.bars, 0))
</script>

<template>
  <div class="song" data-testid="song-sections">
    <p class="total">全曲 {{ totalBars }} 小節，每格一小節</p>
    <ol class="sections">
      <li v-for="section in sections" :key="section.name" class="section">
        <div class="head">
          <strong>{{ section.name }}</strong>
          <span class="meta">{{ section.bars }} 小節・{{ describeStrum(section.strum) }}</span>
        </div>
        <ol class="bars" :aria-label="`${section.name}和弦：${section.progression.map(chordName).join('、')}`">
          <li v-for="(id, i) in section.progression" :key="i" class="bar" aria-hidden="true">{{ chordName(id) }}</li>
        </ol>
        <StrumPatternView :pattern="section.strum" compact />
      </li>
    </ol>
  </div>
</template>

<style scoped>
.song { margin: 8px 0; }
.total { margin: 0 0 8px; font-size: 0.875rem; color: var(--fg-muted); }
.sections { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
.section { padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; }
.head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
.meta { font-size: 0.8125rem; color: var(--fg-muted); }
.bars { list-style: none; padding: 0; margin: 6px 0 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; max-width: 360px; }
.bar { text-align: center; padding: 4px 0; border-radius: 6px; background: var(--bg); font-weight: 600; font-size: 0.9375rem; }
</style>
