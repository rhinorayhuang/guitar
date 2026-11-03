<script setup lang="ts">
import { computed } from 'vue'
import { practicePlan } from '~/data/practice-plan'
import { describeStageRange } from '~/utils/newStages'

const props = withDefaults(defineProps<{ newStageIds: readonly string[]; showLink?: boolean }>(), { showLink: false })
const emit = defineEmits<{ dismiss: [] }>()

const range = computed(() => describeStageRange(practicePlan, props.newStageIds))
const first = computed(() => practicePlan.find(s => s.id === props.newStageIds[0]) ?? null)
</script>

<template>
  <div v-if="newStageIds.length && first" class="new-stages" role="status" data-testid="new-stages-notice">
    <p class="text">
      <strong>新增了{{ range }}！</strong>你之前的過關紀錄都還在，從「{{ first.title }}」繼續往下練。
    </p>
    <div class="actions">
      <NuxtLink v-if="showLink" :to="`/practice#${first.id}`" class="go" @click="emit('dismiss')">去看看 →</NuxtLink>
      <button type="button" class="dismiss" data-testid="new-stages-dismiss" @click="emit('dismiss')">知道了</button>
    </div>
  </div>
</template>

<style scoped>
.new-stages { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin: 12px 0; padding: 10px 14px; border: 1px solid var(--accent); border-radius: 10px; background: var(--surface); }
.text { margin: 0; flex: 1 1 240px; line-height: 1.6; }
.actions { display: flex; align-items: center; gap: 12px; }
.go { color: var(--accent); font-weight: 600; text-decoration: none; }
.dismiss { min-height: 44px; padding: 6px 14px; border-radius: 8px; border: 1px solid var(--border); background: transparent; color: var(--fg-muted); font: inherit; cursor: pointer; }
.go:focus-visible, .dismiss:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
