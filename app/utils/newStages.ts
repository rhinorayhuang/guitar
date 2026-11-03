import type { PracticeStage } from '~/types/chord'

/**
 * 新關卡上線提示（stages-7-plus-draft D-C1）。純函式，不碰 localStorage。
 * 已完成全部舊關卡的使用者，「目前關卡」會從「全部完成」變成新的一關；
 * 沒有提示的話看起來像進度被改掉。
 */

export const SEEN_STAGES_STORAGE_KEY = 'guitar-learning:seen-stages'

/** 這個功能上線前就存在的關卡（2026-11-03 加入第 7–12 關）。之後新增關卡不需要改這裡 */
export const LEGACY_STAGE_IDS: readonly string[] = ['stage-1', 'stage-2', 'stage-3', 'stage-4', 'stage-5', 'stage-6']

/**
 * 讀取「已看過的關卡」。還沒有紀錄時：有過關紀錄的是舊使用者（看過舊關卡），
 * 沒有的是新使用者（回傳 null，表示全部當成已看過、不提示）。
 */
export function resolveSeenStages(raw: string | null, hasProgress: boolean): string[] | null {
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.every(x => typeof x === 'string')) return parsed
    }
    catch { /* 壞掉就當作沒有紀錄 */ }
  }
  return hasProgress ? [...LEGACY_STAGE_IDS] : null
}

export function unseenStages(plan: readonly Pick<PracticeStage, 'id'>[], seen: readonly string[]): string[] {
  const set = new Set(seen)
  return plan.filter(s => !set.has(s.id)).map(s => s.id)
}

/** '第 7–12 關'；不連續時列出：'第 7、9 關' */
export function describeStageRange(plan: readonly Pick<PracticeStage, 'id'>[], ids: readonly string[]): string {
  const nums = ids.map(id => plan.findIndex(s => s.id === id) + 1).filter(n => n > 0).sort((a, b) => a - b)
  if (!nums.length) return ''
  if (nums.length === 1) return `第 ${nums[0]} 關`
  const contiguous = nums.every((n, i) => i === 0 || n === nums[i - 1]! + 1)
  return contiguous ? `第 ${nums[0]}–${nums.at(-1)} 關` : `第 ${nums.join('、')} 關`
}
