import { onMounted, readonly, ref, shallowRef, type Ref } from 'vue'
import {
  PROGRESS_STORAGE_KEY, createBackup, emptyProgress, importBackup, parseProgress, serializeProgress, setStageCompleted,
  type ImportResult, type ProgressData,
} from '~/utils/progress'

/**
 * 關卡完成紀錄的瀏覽器轉接層（PRD P0-4）。SSR 時只有空進度；onMounted 才讀 localStorage。
 * vue API 明確 import，與 useTuner 一致，可在 Vitest 直接掛載測試。
 */

export interface UseProgress {
  progress: Readonly<Ref<ProgressData>>
  /** onMounted 讀過 localStorage 之後才為 true；之前不要用來判斷「目前關卡」以外的事 */
  loaded: Readonly<Ref<boolean>>
  /** localStorage 不可用時顯示一次的提示（Story 4），使用者關掉後不再出現 */
  storageNotice: Readonly<Ref<boolean>>
  setCompleted(stageId: string, completed: boolean): void
  dismissNotice(): void
  /** 下載備份檔（必須在 click 中呼叫） */
  exportBackup(): void
  /** 合併備份檔內容並保存 */
  importFromText(text: string): ImportResult
}

// 同一次瀏覽只提示一次（跨頁面）
let noticeShown = false
// 同一次瀏覽只請求一次永久保存
let persistRequested = false

/**
 * 請瀏覽器把本站資料標為永久保存，降低被自動清除的機會（iOS Safari 對未安裝的網站會清資料）。
 * 盡力而為：不支援或被拒絕都不影響使用。
 */
function requestPersistentStorage() {
  if (persistRequested) return
  persistRequested = true
  try {
    void navigator.storage?.persist?.().catch(() => {})
  }
  catch { /* 不支援 */ }
}

export function useProgress(): UseProgress {
  const progress = shallowRef<ProgressData>(emptyProgress())
  const loaded = ref(false)
  const storageNotice = ref(false)

  function warnOnce() {
    if (noticeShown) return
    noticeShown = true
    storageNotice.value = true
  }

  onMounted(() => {
    try {
      progress.value = parseProgress(localStorage.getItem(PROGRESS_STORAGE_KEY))
    }
    catch {
      warnOnce() // Safari 私密模式、停用網站資料等
    }
    loaded.value = true
  })

  function save() {
    try {
      localStorage.setItem(PROGRESS_STORAGE_KEY, serializeProgress(progress.value))
      requestPersistentStorage()
    }
    catch {
      warnOnce() // 畫面照樣更新，只是不保存
    }
  }

  function setCompleted(stageId: string, completed: boolean) {
    progress.value = setStageCompleted(progress.value, stageId, completed, new Date())
    save()
  }

  function exportBackup() {
    const { filename, json } = createBackup(progress.value, new Date())
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.append(a)
    a.click()
    a.remove()
    // 給瀏覽器時間開始下載再釋放
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function importFromText(text: string): ImportResult {
    const result = importBackup(progress.value, text)
    if (result.ok) {
      progress.value = result.progress
      save()
    }
    return result
  }

  return {
    progress: readonly(progress) as Readonly<Ref<ProgressData>>,
    loaded: readonly(loaded),
    storageNotice: readonly(storageNotice),
    setCompleted,
    dismissNotice: () => { storageNotice.value = false },
    exportBackup,
    importFromText,
  }
}

/** 測試用：重設「只提示一次」與「只請求一次永久保存」 */
export function resetProgressNoticeForTests() {
  noticeShown = false
  persistRequested = false
}
