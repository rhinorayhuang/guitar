/**
 * 練習頁「手指痛怎麼辦」區塊（PRD P0-5、Story 5）。
 * 純內容，修改需經 `guitar-teacher` 審查後才上線。
 */
export interface FingerCareContent {
  title: string
  /** 手機收合時常駐的一句摘要，須涵蓋「1–3 週屬正常」與每日分鐘數（Story 5） */
  summary: (minutes: number) => string
  /** 指尖痛是正常的、大概多久會好 */
  normal: string
  /** 每天短時間比一次練很久好；minutes 為目前關卡的 dailyMinutes */
  dailyPractice: (minutes: number) => string
  /** 出現這些狀況就停下來 */
  stopSigns: string[]
  stopAction: string
  tips: string[]
}

export const fingerCare: FingerCareContent = {
  title: '手指痛怎麼辦？',
  summary: minutes => `指尖壓弦痠痛是正常的，每天練通常 1–3 週會好轉；這關每天 ${minutes} 分鐘就好，別一次練太久。`,
  normal: '剛開始彈，左手指尖壓弦時痠痛是正常的：指尖的皮會慢慢變厚、長出繭。每天練的話，通常 1–3 週就會明顯好轉。',
  dailyPractice: minutes => `每天練一小段，比一次練很久好。這一關建議每天 ${minutes} 分鐘，也可以拆成兩三次；痛到隔天不能練，反而更慢。`,
  stopSigns: [
    '手指發麻',
    '刺痛，像被針扎',
    '指尖起水泡或破皮',
    '手指關節、手腕、前臂或手肘痛',
  ],
  stopAction: '出現以上任何一種，就停下來休息，等不痛、傷口好了再練。休息 2–3 天還是沒好，或越來越嚴重，請先別練，去看醫師。',
  tips: [
    '左手只要壓到聲音清楚就好，不用使出全力；手腕和肩膀保持放鬆',
    '指甲剪短，用指尖立起來壓弦',
    '壓在格子裡靠近琴身那側的金屬條（琴衍）旁邊，最省力',
  ],
}
