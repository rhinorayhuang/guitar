<script setup lang="ts">
import { computed, ref } from 'vue'
import { fingerCare } from '~/data/finger-care'

// PRD P0-5：摘要與停止訊號永遠可見；其餘內容在手機上收合（桌面以 CSS 全部展開，不需等 JS）
const props = defineProps<{
  /** 目前關卡的 dailyMinutes */
  minutes: number
}>()

const summary = computed(() => fingerCare.summary(props.minutes))
const daily = computed(() => fingerCare.dailyPractice(props.minutes))
const expanded = ref(false)
</script>

<template>
  <section class="finger-care" aria-labelledby="finger-care-title" data-testid="finger-care">
    <h2 id="finger-care-title">{{ fingerCare.title }}</h2>
    <p class="summary" data-testid="finger-care-summary">{{ summary }}</p>

    <div class="stop" role="note" data-testid="finger-care-stop">
      <p class="stop-title">出現這些狀況就停：</p>
      <ul>
        <li v-for="sign in fingerCare.stopSigns" :key="sign">{{ sign }}</li>
      </ul>
      <p>{{ fingerCare.stopAction }}</p>
    </div>

    <button
      type="button" class="toggle" aria-controls="finger-care-more" :aria-expanded="expanded"
      data-testid="finger-care-toggle" @click="expanded = !expanded"
    >
      {{ expanded ? '收起' : '為什麼會痛、怎麼壓比較不痛' }}
    </button>
    <div id="finger-care-more" :class="['more', { open: expanded }]" data-testid="finger-care-more">
      <p>{{ fingerCare.normal }}</p>
      <p data-testid="finger-care-daily">{{ daily }}</p>
      <ul class="tips">
        <li v-for="tip in fingerCare.tips" :key="tip">{{ tip }}</li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.finger-care { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px 20px; margin-bottom: 16px; }
.finger-care h2 { margin: 0 0 8px; font-size: 1.0625rem; }
.finger-care p { margin: 0 0 8px; line-height: 1.6; }
.stop { border-left: 3px solid var(--accent); padding-left: 12px; margin: 12px 0; }
.stop-title { font-weight: 600; }
.stop ul { margin: 0 0 8px; padding-left: 20px; }
.tips { color: var(--fg-muted); font-size: 0.875rem; margin: 0; padding-left: 20px; }

.toggle {
  min-height: 44px; padding: 8px 0; background: none; border: none;
  color: var(--accent); font: inherit; text-decoration: underline; cursor: pointer;
}
.toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.more { display: none; margin-top: 4px; }
.more.open { display: block; }

/* 桌面：空間夠，全部展開；摘要與完整內容重複，隱藏摘要 */
@media (min-width: 640px) {
  .finger-care { display: flex; flex-direction: column; }
  .summary, .toggle { display: none; }
  /* 桌面維持「先說明正常的痛，再講何時停」的閱讀順序 */
  .more { display: block; margin-top: 0; order: 1; }
  .stop { order: 2; margin-bottom: 0; }
}
</style>
