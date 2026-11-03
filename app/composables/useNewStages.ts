import { readonly, ref, watch, type Ref } from 'vue'
import { practicePlan } from '~/data/practice-plan'
import type { ProgressData } from '~/utils/progress'
import { SEEN_STAGES_STORAGE_KEY, resolveSeenStages, unseenStages } from '~/utils/newStages'

/**
 * 新關卡上線提示的瀏覽器轉接層。等 useProgress 讀完 localStorage（loaded）才判斷，
 * SSR 與 hydration 期間永遠沒有提示。
 */
export interface UseNewStages {
  /** 尚未看過的關卡 id；空陣列 = 不顯示提示 */
  newStageIds: Readonly<Ref<string[]>>
  /** 記為全部已看過（「知道了」） */
  dismiss(): void
}

function writeSeen(ids: string[]) {
  try {
    localStorage.setItem(SEEN_STAGES_STORAGE_KEY, JSON.stringify(ids))
  }
  catch { /* 存不了就下次再提示，不影響使用 */ }
}

export function useNewStages(progress: Readonly<Ref<ProgressData>>, loaded: Readonly<Ref<boolean>>): UseNewStages {
  const newStageIds = ref<string[]>([])
  const allIds = () => practicePlan.map(s => s.id)

  watch(loaded, (isLoaded) => {
    if (!isLoaded) return
    let raw: string | null = null
    try {
      raw = localStorage.getItem(SEEN_STAGES_STORAGE_KEY)
    }
    catch { /* 讀不到就當作沒有紀錄 */ }
    const seen = resolveSeenStages(raw, Object.keys(progress.value.stages).length > 0)
    if (seen === null) {
      writeSeen(allIds()) // 新使用者：現有關卡都不算「新」
      return
    }
    newStageIds.value = unseenStages(practicePlan, seen)
  }, { immediate: true })

  return {
    newStageIds: readonly(newStageIds) as Readonly<Ref<string[]>>,
    dismiss() {
      writeSeen(allIds())
      newStageIds.value = []
    },
  }
}
