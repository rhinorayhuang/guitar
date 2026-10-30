<script setup lang="ts">
import { ref } from 'vue'
import type { ImportResult } from '~/utils/progress'

// 進度只存在這個瀏覽器（D-07）：換手機、換網址（tunnel ↔ GitHub Pages 是不同網站）時用備份檔搬家
const props = defineProps<{
  exportBackup: () => void
  importFromText: (text: string) => ImportResult
}>()

const message = ref<{ ok: boolean; text: string } | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const REASONS: Record<Extract<ImportResult, { ok: false }>['reason'], string> = {
  'invalid-json': '這個檔案不是有效的備份檔。',
  'not-a-backup': '這個檔案不是本 App 匯出的進度備份。',
  'unsupported-version': '這個備份檔的版本不支援，請用最新版 App 重新匯出。',
}

function onExport() {
  props.exportBackup()
  message.value = { ok: true, text: '已下載備份檔，請存到雲端硬碟或傳給自己保管。' }
}

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 同一個檔案可以再選一次
  if (!file) return
  const result = props.importFromText(await file.text())
  message.value = result.ok
    ? { ok: true, text: result.added > 0 ? `匯入完成，新增 ${result.added} 關過關紀錄。` : '匯入完成，沒有新的過關紀錄。' }
    : { ok: false, text: REASONS[result.reason] }
}
</script>

<template>
  <details class="backup" data-testid="progress-backup">
    <summary>備份與搬移進度</summary>
    <p class="intro">
      過關紀錄只存在這個瀏覽器，不會上傳。換手機、換瀏覽器或清除網站資料前，請先匯出備份；
      在新的地方「匯入」同一個檔案即可還原（會和現有紀錄合併，不會覆蓋）。
    </p>
    <div class="buttons">
      <button type="button" data-testid="backup-export" @click="onExport">匯出進度</button>
      <button type="button" data-testid="backup-import" @click="fileInput?.click()">匯入進度</button>
      <input
        ref="fileInput" type="file" accept="application/json,.json" class="file"
        data-testid="backup-file" aria-label="選擇進度備份檔" @change="onFile"
      >
    </div>
    <p v-if="message" :class="['message', { error: !message.ok }]" role="status" data-testid="backup-message">
      {{ message.text }}
    </p>
  </details>
</template>

<style scoped>
.backup { margin-top: 16px; padding: 12px 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
.backup summary { cursor: pointer; font-weight: 600; min-height: 32px; display: flex; align-items: center; }
.backup summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.intro { color: var(--fg-muted); font-size: 0.875rem; line-height: 1.6; margin: 8px 0; }
.buttons { display: flex; flex-wrap: wrap; gap: 8px; }
.buttons button {
  min-height: 44px; padding: 8px 18px; border-radius: 10px; font: inherit; cursor: pointer;
  background: transparent; color: var(--fg); border: 1px solid var(--border);
}
.buttons button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.file { display: none; }
.message { margin: 8px 0 0; font-size: 0.875rem; }
.message.error { color: var(--accent); }
</style>
