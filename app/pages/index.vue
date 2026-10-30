<script setup lang="ts">
import { practicePlan } from '~/data/practice-plan'
import { useProgress } from '~/composables/useProgress'
import { currentStageId } from '~/utils/progress'

useSeoMeta({ title: '吉他學習', description: '從第一個和弦開始的吉他練習 App' })

// P0-4：首頁顯示目前所在關卡（讀到 localStorage 之後才顯示）
const { progress, loaded } = useProgress()
const current = computed(() => {
  if (!loaded.value) return null
  const id = currentStageId(practicePlan, progress.value)
  const index = practicePlan.findIndex(s => s.id === id)
  return { id, index, stage: practicePlan[index] ?? null }
})
</script>

<template>
  <section>
    <h1>從第一個和弦開始</h1>
    <p>依照練習進度一關一關學，每一關都有明確的過關標準。</p>

    <div v-if="current" class="current card" data-testid="home-current-stage">
      <template v-if="current.stage">
        <p class="label">目前關卡</p>
        <p class="title">第 {{ current.index + 1 }} 關：{{ current.stage.title }}</p>
        <div class="links">
          <NuxtLink to="/tuner" class="tune" data-testid="home-tune-first">先調音</NuxtLink>
          <NuxtLink :to="`/practice#${current.id}`" class="go">繼續練習 →</NuxtLink>
        </div>
      </template>
      <template v-else>
        <p class="title">{{ practicePlan.length }} 關全部過關了，太棒了！</p>
        <NuxtLink to="/practice" class="go">回顧練習進度 →</NuxtLink>
      </template>
    </div>

    <ul>
      <li><NuxtLink to="/tuner">調音器</NuxtLink>：練習前先把吉他調準</li>
      <li><NuxtLink to="/chords">和弦圖鑑</NuxtLink>：開放和弦與封閉和弦的標準指法</li>
      <li><NuxtLink to="/practice">練習進度</NuxtLink>：初學者 6 個階段</li>
    </ul>
  </section>
</template>

<style scoped>
.card { background: var(--surface); border: 1px solid var(--accent); border-radius: 12px; padding: 16px 20px; margin: 16px 0; }
.label { margin: 0; color: var(--fg-muted); font-size: 0.875rem; }
.title { margin: 4px 0 8px; font-size: 1.125rem; font-weight: 600; }
.links { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; }
.go { color: var(--accent); font-weight: 600; text-decoration: none; }
.tune { color: var(--fg-muted); }
</style>
