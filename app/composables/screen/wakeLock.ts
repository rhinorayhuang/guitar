/**
 * Screen Wake Lock 轉接（產品決定 D-M2，無 Vue）。播放中保持螢幕常亮。
 * - 不支援或取得失敗時靜默略過（不顯示錯誤）。
 * - release() 可以在 request 尚未 resolve 時呼叫：resolve 後會立刻釋放，不會殘留。
 * - 頁面切到背景時瀏覽器會自動釋放；本模組不自動重新取得（擁有者此時已停止播放）。
 */

export interface ScreenWakeLock {
  acquire(): void
  release(): void
  /** 目前是否持有 */
  readonly held: boolean
}

type WakeLockNavigator = { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinel> } }

const defaultNavigator = (): WakeLockNavigator | undefined =>
  (typeof navigator === 'undefined' ? undefined : navigator as WakeLockNavigator)

export function createScreenWakeLock(getNavigator: () => WakeLockNavigator | undefined = defaultNavigator): ScreenWakeLock {
  let sentinel: WakeLockSentinel | null = null
  let pending = false
  let generation = 0

  const releaseSentinel = (s: WakeLockSentinel) => {
    try {
      s.release().catch(() => {})
    }
    catch { /* 已釋放 */ }
  }

  return {
    acquire() {
      if (sentinel || pending) return
      const wakeLock = getNavigator()?.wakeLock
      if (!wakeLock || typeof wakeLock.request !== 'function') return
      const token = ++generation
      let request: Promise<WakeLockSentinel>
      try {
        request = wakeLock.request('screen')
      }
      catch {
        return
      }
      pending = true
      Promise.resolve(request).then(
        (s) => {
          if (token !== generation) return releaseSentinel(s) // 期間已 release()
          pending = false
          sentinel = s
          s.addEventListener?.('release', () => {
            if (sentinel === s) sentinel = null
          })
        },
        () => {
          if (token === generation) pending = false // NotAllowedError 等：靜默略過
        },
      )
    },
    release() {
      generation++
      pending = false
      const s = sentinel
      sentinel = null
      if (s) releaseSentinel(s)
    },
    get held() {
      return sentinel !== null
    },
  }
}
