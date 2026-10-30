/** 環境判斷與錯誤分類（純函式；瀏覽器資訊由呼叫端注入）。對應 PRD §5.1.6 */

export type TunerErrorKind = 'permission-denied' | 'not-found' | 'not-readable' | 'unknown'

export type EnvironmentStatus =
  | { ok: true }
  | { ok: false; reason: 'insecure' | 'unsupported'; audioOutputAvailable: boolean }

export type InAppBrowser = 'line' | 'instagram' | 'facebook'

/** 判斷順序固定：secure context → API 支援 */
export function checkEnvironment(env: { isSecureContext: boolean; hasGetUserMedia: boolean; hasAudioContext: boolean }): EnvironmentStatus {
  if (!env.isSecureContext) return { ok: false, reason: 'insecure', audioOutputAvailable: env.hasAudioContext }
  if (!env.hasGetUserMedia || !env.hasAudioContext) return { ok: false, reason: 'unsupported', audioOutputAvailable: env.hasAudioContext }
  return { ok: true }
}

const ERROR_KINDS: Record<string, TunerErrorKind> = {
  NotAllowedError: 'permission-denied',
  SecurityError: 'permission-denied',
  NotFoundError: 'not-found',
  OverconstrainedError: 'not-found',
  NotReadableError: 'not-readable',
  AbortError: 'not-readable',
}

/** 依 DOMException.name 分類；非 Error 物件或未知名稱 → unknown */
export function classifyStartError(error: unknown): TunerErrorKind {
  if (typeof error !== 'object' || error === null) return 'unknown'
  const name = (error as { name?: unknown }).name
  return (typeof name === 'string' && ERROR_KINDS[name]) || 'unknown'
}

export function detectInAppBrowser(userAgent: string): InAppBrowser | null {
  if (/\bLine\//i.test(userAgent)) return 'line'
  if (/Instagram/.test(userAgent)) return 'instagram'
  if (/FBAN|FBAV|FB_IAB|FBIOS/.test(userAgent)) return 'facebook'
  return null
}
