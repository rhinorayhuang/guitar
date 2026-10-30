<script setup lang="ts">
import type { ChordShape } from '~/types/chord'

const props = withDefaults(defineProps<{
  chord: ChordShape
  /** Number of frets shown */
  frets?: number
  /** Show the sounding note name under each string (root highlighted) */
  showNotes?: boolean
}>(), { frets: 4, showNotes: false })

const STRING_GAP = 24
const FRET_GAP = 30
const LEFT = 24
const TOP = 40

const fretted = computed(() => props.chord.frets.filter((f): f is number => f !== null && f > 0))
// Show from fret 1 when the shape fits; otherwise start at the lowest fretted note
const startFret = computed(() => {
  const max = Math.max(0, ...fretted.value)
  return max <= props.frets ? 1 : Math.min(...fretted.value)
})

const NOTE_ROW = 20

const width = LEFT * 2 + STRING_GAP * 5
const height = computed(() => TOP + FRET_GAP * props.frets + 24 + (props.showNotes ? NOTE_ROW : 0))
const noteY = computed(() => TOP + FRET_GAP * props.frets + 22)
const noteNames = computed(() => stringNoteNames(props.chord))

const x = (stringIndex: number) => LEFT + stringIndex * STRING_GAP
const y = (fret: number) => TOP + (fret - startFret.value + 0.5) * FRET_GAP

const barreRect = computed(() => {
  const b = props.chord.barre
  if (!b) return null
  const x1 = x(6 - b.fromString)
  const x2 = x(6 - b.toString)
  return { x: x1 - 9, y: y(b.fret) - 9, width: x2 - x1 + 18 }
})

const label = computed(() => {
  const strings = props.chord.frets.map(f => (f === null ? 'x' : f)).join(' ')
  const base = `${props.chord.name} 和弦指法，第 6 弦到第 1 弦：${strings}`
  if (!props.showNotes) return base
  return `${base}；發聲音名：${noteNames.value.map(n => n ?? '不彈').join(' ')}`
})
</script>

<template>
  <svg :viewBox="`0 0 ${width} ${height}`" class="chord-diagram" role="img" :aria-label="label">
    <!-- Nut, or starting fret number -->
    <rect v-if="startFret === 1" :x="LEFT" :y="TOP - 4" :width="STRING_GAP * 5" height="5" class="ink" />
    <text v-else :x="LEFT - 8" :y="TOP + FRET_GAP / 2 + 4" text-anchor="end" class="fret-label">{{ startFret }}</text>

    <line
      v-for="n in frets + 1" :key="`fret-${n}`"
      :x1="LEFT" :x2="LEFT + STRING_GAP * 5"
      :y1="TOP + (n - 1) * FRET_GAP" :y2="TOP + (n - 1) * FRET_GAP"
      class="line"
    />
    <line
      v-for="(_, i) in 6" :key="`string-${i}`"
      :x1="x(i)" :x2="x(i)" :y1="TOP" :y2="TOP + frets * FRET_GAP"
      class="line"
    />

    <rect v-if="barreRect" v-bind="barreRect" height="18" rx="9" class="ink" />

    <template v-for="(fret, i) in chord.frets" :key="`mark-${i}`">
      <text v-if="fret === null" :x="x(i)" :y="TOP - 14" text-anchor="middle" class="marker">×</text>
      <circle v-else-if="fret === 0" :cx="x(i)" :cy="TOP - 18" r="6" class="open" />
      <g v-else>
        <circle :cx="x(i)" :cy="y(fret)" r="10" class="ink" />
        <text :x="x(i)" :y="y(fret) + 4" text-anchor="middle" class="finger">{{ chord.fingers[i] }}</text>
      </g>
    </template>

    <template v-if="showNotes">
      <template v-for="(note, i) in noteNames" :key="`note-${i}`">
        <text
          v-if="note"
          :x="x(i)" :y="noteY" text-anchor="middle"
          :class="['note', { root: note === chord.root }]"
          data-testid="string-note"
        >{{ note }}</text>
      </template>
    </template>
  </svg>
</template>

<style scoped>
.chord-diagram { width: 100%; max-width: 180px; }
.line { stroke: var(--fg-muted); stroke-width: 1.5; }
.ink { fill: var(--fg); }
.open { fill: none; stroke: var(--fg); stroke-width: 1.5; }
.marker { fill: var(--fg); font-size: 16px; }
.finger { fill: var(--bg); font-size: 12px; font-weight: 600; }
.fret-label { fill: var(--fg-muted); font-size: 12px; }
.note { fill: var(--fg-muted); font-size: 11px; }
.note.root { fill: var(--accent); font-weight: 700; }
</style>
