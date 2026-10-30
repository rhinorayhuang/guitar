<script setup lang="ts">
import TunerPanel from '~/components/tuner/TunerPanel.vue'
import { tunerCopy } from '~/data/tuner-copy'

useSeoMeta({ title: '調音器', description: '用手機麥克風調吉他標準音（E2 A2 D3 G3 B3 E4），也可以播放參考音用耳朵對音。' })
</script>

<template>
  <section class="tuner-page">
    <h1>調音器</h1>
    <!-- 互動部分只在 client 執行；SSR 只輸出外殼與隱私聲明（architecture §6.1） -->
    <ClientOnly>
      <TunerPanel />
      <template #fallback>
        <div class="skeleton" aria-hidden="true">
          <div class="block tall" />
          <div class="block" />
          <div class="block" />
        </div>
      </template>
    </ClientOnly>
    <p class="privacy" data-testid="tuner-privacy">{{ tunerCopy.privacy }}</p>
  </section>
</template>

<style scoped>
.tuner-page { max-width: 560px; margin: 0 auto; }
h1 { margin-top: 0; }
.skeleton { display: grid; gap: 12px; }
.block { height: 72px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border); }
.block.tall { height: 320px; }
.privacy { margin-top: 16px; font-size: 0.8125rem; color: var(--fg-muted); text-align: center; }
</style>
