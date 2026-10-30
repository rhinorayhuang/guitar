import { silentModeHint } from '~/data/audio-copy'
import type { TunerErrorKind } from '~/utils/tuner/environment'

/** 調音器文案（PRD §5.1.6 / §5.1.4 / §5.1.9 / §5.1.10）。最終字句由 Design 微調，語意不可變 */
export const tunerCopy = {
  intro: {
    title: '需要使用麥克風',
    body: '調音器要聽你撥弦的聲音。聲音只在這支手機上即時分析，不會錄音、不會上傳。',
    startButton: '開始調音',
  },
  starting: '正在開啟麥克風…',
  waiting: '請撥一條空弦',
  direction: {
    tooLow: '太低，轉緊（調高）',
    tooHigh: '太高，轉鬆（調低）',
    farLow: '差很多，請繼續轉緊',
    farHigh: '差很多，請繼續轉鬆',
    approaching: '快好了，保持住',
    inTune: '準了',
  },
  noisy: '環境有點吵，或聲音不清楚。請靠近手機、一次只撥一條空弦。',
  paused: '調音已暫停，點一下繼續',
  resume: '繼續調音',
  stop: '停止調音',
  referencePlaying: '播放參考音中',
  errors: {
    'permission-denied': '沒有麥克風權限，聽不到你的吉他。',
    'not-found': '找不到麥克風。請確認裝置有麥克風，或用下方參考音對音。',
    'not-readable': '麥克風正被其他 App 使用（例如通話或錄音中）。請先關閉，再按『再試一次』。',
    'unknown': '麥克風開啟失敗，請再試一次，或用下方參考音對音。',
    'insecure': '這個網址不是安全連線（https），瀏覽器不允許使用麥克風。請改用 https:// 開頭的網址開啟。',
    'unsupported': '這個瀏覽器不支援麥克風調音。請用 iPhone 的 Safari 或 Android 的 Chrome 開啟。',
  } satisfies Record<TunerErrorKind | 'insecure' | 'unsupported', string>,
  /** TUN-57：連 AudioContext 都沒有時，參考音也無法播放 */
  noAudioOutput: '這個瀏覽器也無法播放參考音。',
  permissionSteps: {
    ios: '點網址列的『大小』(aA) 圖示 → 網站設定 → 麥克風 → 允許，再重新整理頁面。',
    android: '點網址列左側的設定圖示 → 權限 → 麥克風 → 允許，再重新整理頁面。',
    desktop: '點網址列左側的圖示 → 麥克風 → 允許，再重新整理頁面。',
    fallback: '也可以用下方參考音，用耳朵對音。',
  },
  inAppHint: '你可能正在 App 內建的瀏覽器中，請點右上角選單，選擇『用瀏覽器開啟』。',
  privacy: '聲音只在這支手機上分析，不會錄音、不會上傳。',
  referenceTitle: '參考音',
  /** TUN-94：與節拍器共用（app/data/audio-copy.ts） */
  referenceHint: silentModeHint,
  retry: '再試一次',
  auto: '自動',
  manual: '手動',
  stringLabel: (stringNumber: number) => `第 ${stringNumber} 弦`,
  announceReading: (label: string, stringNumber: number) => `偵測到 ${label}，第 ${stringNumber} 弦`,
} as const

export function permissionPlatform(userAgent: string): 'ios' | 'android' | 'desktop' {
  // iPadOS 13+ 的 Safari 會偽裝成 Macintosh，無法單靠 UA 區分；這裡以 iPhone/iPad/iPod 判斷
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios'
  if (/Android/i.test(userAgent)) return 'android'
  return 'desktop'
}
