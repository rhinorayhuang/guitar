import type { PracticeStage } from '~/types/chord'

/**
 * 關卡完成紀錄（PRD P0-4）。純函式，不碰 localStorage；讀寫由 useProgress 負責。
 * 資料帶版本號，第一層以功能分命名空間（PA-05）：日後加入 `theory` 等進度時並列新 key，
 * 不需遷移既有的 `stages`。作品（編曲）未來放 IndexedDB，不放這裡。
 */

export const PROGRESS_STORAGE_KEY = 'guitar-learning:progress'
export const PROGRESS_VERSION = 1

export interface StageProgress {
  /** ISO 8601 */
  completedAt: string
}

export interface ProgressData {
  v: typeof PROGRESS_VERSION
  /** key = PracticeStage.id */
  stages: Record<string, StageProgress>
}

export const emptyProgress = (): ProgressData => ({ v: PROGRESS_VERSION, stages: {} })

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

/** 壞掉、版本不明或格式不符時回傳空進度，不拋例外；個別壞掉的關卡紀錄直接略過 */
export function parseProgress(raw: string | null): ProgressData {
  if (!raw) return emptyProgress()
  let data: unknown
  try {
    data = JSON.parse(raw)
  }
  catch {
    return emptyProgress()
  }
  if (!isRecord(data) || data.v !== PROGRESS_VERSION || !isRecord(data.stages)) return emptyProgress()
  const stages: Record<string, StageProgress> = {}
  for (const [id, entry] of Object.entries(data.stages)) {
    if (isRecord(entry) && typeof entry.completedAt === 'string') stages[id] = { completedAt: entry.completedAt }
  }
  return { v: PROGRESS_VERSION, stages }
}

export const serializeProgress = (data: ProgressData): string => JSON.stringify(data)

/** 回傳新物件；取消時移除該關紀錄（Story 4：可取消單一關卡） */
export function setStageCompleted(data: ProgressData, stageId: string, completed: boolean, now: Date): ProgressData {
  const stages = { ...data.stages }
  if (completed) stages[stageId] = stages[stageId] ?? { completedAt: now.toISOString() }
  else delete stages[stageId]
  return { ...data, stages }
}

export const isStageCompleted = (data: ProgressData, stageId: string): boolean => stageId in data.stages

/**
 * 備份檔（D-07：資料只在本機，以匯出檔搬家或備份）。外層包一層標記，
 * 匯入時才能分辨「這是本 App 的進度檔」而不是任意 JSON。
 */
export const BACKUP_APP_ID = 'guitar-learning'

export interface ProgressBackup {
  app: typeof BACKUP_APP_ID
  exportedAt: string
  progress: ProgressData
}

export function createBackup(data: ProgressData, now: Date): { filename: string; json: string } {
  const backup: ProgressBackup = { app: BACKUP_APP_ID, exportedAt: now.toISOString(), progress: data }
  return { filename: `guitar-progress-${now.toISOString().slice(0, 10)}.json`, json: JSON.stringify(backup, null, 2) }
}

export type ImportResult =
  | { ok: true; progress: ProgressData; added: number }
  | { ok: false; reason: 'invalid-json' | 'not-a-backup' | 'unsupported-version' }

/**
 * 匯入是「合併」而不是覆蓋：兩邊都有的關卡保留較早的完成時間，只在一邊有的都保留，
 * 所以匯入舊備份不會讓目前的紀錄消失。代價：在這台裝置取消過關後，再匯入含該關的舊備份，該關會重新標為已過關。
 */
export function importBackup(current: ProgressData, text: string): ImportResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  }
  catch {
    return { ok: false, reason: 'invalid-json' }
  }
  if (!isRecord(raw) || raw.app !== BACKUP_APP_ID || !isRecord(raw.progress)) return { ok: false, reason: 'not-a-backup' }
  if (raw.progress.v !== PROGRESS_VERSION) return { ok: false, reason: 'unsupported-version' }
  const incoming = parseProgress(JSON.stringify(raw.progress))
  const stages = { ...current.stages }
  let added = 0
  for (const [id, entry] of Object.entries(incoming.stages)) {
    const existing = stages[id]
    if (!existing) added++
    if (!existing || entry.completedAt < existing.completedAt) stages[id] = entry
  }
  return { ok: true, progress: { ...current, stages }, added }
}

/** 不強制依序解鎖：目前關卡 = 第一個未完成的關卡；全部完成時為 null */
export function currentStageId(plan: readonly Pick<PracticeStage, 'id'>[], data: ProgressData): string | null {
  return plan.find(s => !isStageCompleted(data, s.id))?.id ?? null
}
