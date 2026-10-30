<script setup lang="ts">
import { computed } from 'vue'
import type { TunerPhase } from '~/composables/useTuner'
import { permissionPlatform, tunerCopy } from '~/data/tuner-copy'

const props = defineProps<{
  phase: Extract<TunerPhase, { kind: 'error' | 'blocked' | 'paused' }>
  userAgent: string
}>()
const emit = defineEmits<{ retry: [] }>()

const message = computed(() => {
  const p = props.phase
  if (p.kind === 'paused') return tunerCopy.paused
  if (p.kind === 'error') return tunerCopy.errors[p.error]
  return tunerCopy.errors[p.reason]
})
const permissionStep = computed(() =>
  props.phase.kind === 'error' && props.phase.error === 'permission-denied'
    ? tunerCopy.permissionSteps[permissionPlatform(props.userAgent)]
    : null)
const inApp = computed(() => props.phase.kind !== 'paused' && props.phase.inAppBrowser !== null)
const noAudioOutput = computed(() => props.phase.kind === 'blocked' && !props.phase.audioOutputAvailable)
// blocked（非安全來源 / 不支援）時重試沒有意義，不顯示按鈕（TUN-56/57）
const retryLabel = computed(() => props.phase.kind === 'paused' ? tunerCopy.resume : props.phase.kind === 'error' ? tunerCopy.retry : null)
</script>

<template>
  <div class="notice" :class="`is-${phase.kind}`" role="status" data-testid="tuner-notice">
    <p class="message">{{ message }}</p>
    <template v-if="permissionStep">
      <p class="step" data-testid="permission-step">{{ permissionStep }}</p>
      <p class="hint">{{ tunerCopy.permissionSteps.fallback }}</p>
    </template>
    <p v-if="noAudioOutput" class="hint">{{ tunerCopy.noAudioOutput }}</p>
    <p v-if="inApp" class="hint in-app" data-testid="in-app-hint">{{ tunerCopy.inAppHint }}</p>
    <button v-if="retryLabel" type="button" class="primary" data-testid="tuner-retry" @click="emit('retry')">
      {{ retryLabel }}
    </button>
  </div>
</template>

<style scoped>
.notice { text-align: center; }
.message { margin: 0 0 8px; font-weight: 700; }
.step { margin: 0 0 8px; padding: 8px 12px; border-radius: 8px; background: var(--bg); border: 1px solid var(--border); text-align: left; }
.hint { margin: 0 0 8px; color: var(--fg-muted); font-size: 0.875rem; }
.in-app { color: var(--accent); }
.primary {
  margin-top: 8px; min-height: 48px; min-width: 160px; padding: 10px 24px;
  border: none; border-radius: 12px; background: var(--accent); color: #fff;
  font: inherit; font-weight: 700; cursor: pointer;
}
.primary:focus-visible { outline: 2px solid var(--fg); outline-offset: 2px; }
</style>
