<script setup lang="ts">
import { chords } from '~/data/chords'

useSeoMeta({ title: '和弦圖鑑' })

const sorted = computed(() => [...chords].sort((a, b) => a.difficulty - b.difficulty))
</script>

<template>
  <section>
    <h1>和弦圖鑑</h1>
    <ul class="grid">
      <li v-for="chord in sorted" :key="chord.id" class="card">
        <h2>{{ chord.name }}</h2>
        <p class="tones" :aria-label="`組成音 ${chordTones(chord.root, chord.quality).join(' ')}，根音 ${chord.root}`">
          <span class="tones-label">組成音</span>
          <span
            v-for="note in chordTones(chord.root, chord.quality)" :key="note"
            :class="['tone', { root: note === chord.root }]"
          >{{ note }}</span>
        </p>
        <ChordDiagram :chord="chord" show-notes />
        <p class="difficulty">難度 {{ '●'.repeat(chord.difficulty) }}{{ '○'.repeat(5 - chord.difficulty) }}</p>
        <p v-for="tip in chord.tips" :key="tip" class="tip">{{ tip }}</p>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.grid { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; text-align: center; }
.card h2 { margin: 0 0 8px; }
.tones { display: flex; justify-content: center; align-items: baseline; gap: 6px; margin: 0 0 8px; font-size: 0.9375rem; }
.tones-label { color: var(--fg-muted); font-size: 0.8125rem; }
.tone { font-weight: 600; }
.tone.root { color: var(--accent); }
.difficulty { color: var(--accent); margin: 8px 0 4px; letter-spacing: 2px; }
.tip { color: var(--fg-muted); font-size: 0.875rem; margin: 4px 0 0; text-align: left; }
</style>
