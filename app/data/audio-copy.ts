/**
 * 會發出聲音的功能共用的文案（調音器參考音、節拍器）。最終字句由 Design 微調，語意不可變。
 * TUN-94：iOS 靜音開關打開時網頁音訊沒有聲音；不偵測 UA，始終顯示。
 */
export const audioCopy = {
  silentModeHint: '聽不到聲音？請確認手機沒有開啟靜音模式並調高音量。',
} as const

export const silentModeHint = audioCopy.silentModeHint
