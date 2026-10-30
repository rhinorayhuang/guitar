<script setup lang="ts">
import { computed } from 'vue'
import { tunerCopy } from '~/data/tuner-copy'
import type { TunerView } from '~/utils/tuner/tunerView'

const props = defineProps<{ view: TunerView }>()

const isWaiting = computed(() => props.view.status === 'waiting')
const isInTune = computed(() => props.view.status === 'inTune')
// 指針用 translateX：包裝層寬 100%，位移 needle × 50% 即從中央移到端點
const needleStyle = computed(() => ({ transform: `translateX(${(props.view.needle * 50).toFixed(2)}%)` }))
</script>

<template>
  <div
    class="meter"
    :class="{
      'is-waiting': isWaiting,
      'is-in-tune': isInTune,
      'is-approaching': view.status === 'approaching',
      'is-fading': view.fading,
    }"
    data-testid="tuner-meter"
  >
    <div class="note" aria-hidden="true">
      <template v-if="!isWaiting">
        <span class="note-name">{{ view.noteName }}</span>
        <span class="note-label">{{ view.noteLabel }}</span>
      </template>
      <span v-else class="note-name note-placeholder">–</span>
    </div>
    <p class="string-label">{{ view.stringLabel ?? ' ' }}</p>

    <div class="scale" aria-hidden="true">
      <div class="zone" />
      <div class="center-tick" />
      <span class="scale-end scale-min">−50</span>
      <span class="scale-end scale-max">+50</span>
      <div class="needle-track" :style="needleStyle">
        <div class="needle" />
      </div>
    </div>

    <div class="readout">
      <p v-if="!isWaiting" class="cents" data-testid="tuner-cents">{{ view.centsText }}</p>
      <p class="status" data-testid="tuner-status">
        <svg v-if="isInTune" class="check" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" data-testid="tuner-check">
          <path d="M4 12.5l5 5L20 6.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span>{{ isWaiting ? tunerCopy.waiting : view.directionText }}</span>
      </p>
      <p class="frequency">{{ view.frequencyText ?? ' ' }}</p>
    </div>

    <!-- aria-live 播報區常駐在 TunerPanel（本元件以 v-if 掛載，插入時就帶內容的 live region 多半不會被讀出） -->
  </div>
</template>

<style scoped>
.meter {
  --ok: #2f8f4e;
  --needle: var(--accent);
  text-align: center;
  transition: opacity 0.12s ease;
}
@media (prefers-color-scheme: dark) {
  .meter { --ok: #5cc27e; }
}
/* 偶發的單幀 unclear 不應讓畫面閃爍：延遲後才開始淡出 */
.meter.is-fading { opacity: 0.5; transition: opacity 1s ease 0.3s; }

.note { display: flex; align-items: baseline; justify-content: center; gap: 6px; min-height: 5.5rem; }
.note-name { font-size: 4.5rem; font-weight: 700; line-height: 1.2; }
.note-label { font-size: 1.25rem; color: var(--fg-muted); }
.note-placeholder { color: var(--border); }
.string-label { margin: 0; color: var(--fg-muted); }

.scale { position: relative; height: 72px; margin: 20px 0 8px; border-bottom: 2px solid var(--border); }
/* ±5 cents 區：寬 10% = 10/100 cents */
.zone { position: absolute; left: 45%; width: 10%; top: 0; bottom: 0; background: color-mix(in srgb, var(--ok) 18%, transparent); border-radius: 6px 6px 0 0; }
.center-tick { position: absolute; left: 50%; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--fg-muted); opacity: 0.5; }
.scale-end { position: absolute; bottom: -1.6rem; font-size: 0.75rem; color: var(--fg-muted); }
.scale-min { left: 0; }
.scale-max { right: 0; }
.needle-track { position: absolute; inset: 0; transition: transform 0.08s linear; }
.needle { position: absolute; left: 50%; top: 4px; bottom: 0; width: 4px; margin-left: -2px; border-radius: 2px; background: var(--needle); }
.is-waiting .needle { background: var(--fg-muted); opacity: 0.4; }
.is-in-tune .needle { background: var(--ok); }

.readout { margin-top: 28px; }
.cents { margin: 0; font-size: 2rem; font-weight: 700; font-variant-numeric: tabular-nums; }
.status { display: inline-flex; align-items: center; gap: 6px; margin: 4px 0; font-size: 1.125rem; min-height: 1.75rem; }
.is-in-tune .status { color: var(--ok); font-weight: 700; }
.check { flex: none; }
.frequency { margin: 0; font-size: 0.875rem; color: var(--fg-muted); font-variant-numeric: tabular-nums; }


@media (prefers-reduced-motion: reduce) {
  .needle-track, .meter, .meter.is-fading { transition: none; }
}
</style>
