<script setup lang="ts">
import { computed } from 'vue'
import type { StrumPattern } from '~/types/chord'
import { describeStrum, parseStrum } from '~/utils/strum'

const props = withDefaults(defineProps<{ pattern: StrumPattern; compact?: boolean }>(), { compact: false })

const cells = computed(() => parseStrum(props.pattern))
const label = computed(() => `刷法：${describeStrum(props.pattern)}`)
</script>

<template>
  <figure :class="['strum', { compact }]" data-testid="strum-pattern">
    <ol class="cells" role="img" :aria-label="label">
      <li
        v-for="(cell, i) in cells" :key="i"
        :class="['cell', cell.stroke, { beat: i % 2 === 0 }]"
        aria-hidden="true"
      >
        <span class="arrow">{{ cell.handDirection === 'down' ? '↓' : '↑' }}</span>
        <span class="count">{{ cell.count }}</span>
      </li>
    </ol>
    <figcaption v-if="!compact" class="caption">{{ describeStrum(pattern) }}・淡色＝手照樣揮但不碰弦</figcaption>
  </figure>
</template>

<style scoped>
.strum { margin: 8px 0; }
.cells { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 2px; max-width: 360px; }
.cell { display: flex; flex-direction: column; align-items: center; padding: 4px 0; border-radius: 6px; background: var(--bg); }
.cell.beat { border-left: 1px solid var(--border); }
.arrow { font-size: 1.125rem; font-weight: 700; line-height: 1.2; color: var(--accent); }
.cell.miss .arrow { color: var(--border); font-weight: 400; }
.count { font-size: 0.75rem; color: var(--fg-muted); }
.cell.beat .count { color: var(--fg); font-weight: 600; }
.caption { margin-top: 4px; font-size: 0.8125rem; color: var(--fg-muted); }
.compact .cells { max-width: 240px; }
.compact .arrow { font-size: 0.9375rem; }
</style>
