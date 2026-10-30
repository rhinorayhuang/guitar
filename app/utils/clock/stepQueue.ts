/**
 * 已排程步的佇列（§5.2）：排程時 push，視覺 rAF 時以可聽時間 advance。純資料結構。
 * 不從錨點反推目前的步，所以改速度、跳拍後不需要錨點歷史。
 */

export interface QueuedStep { step: number; time: number; beatInBar: number }

export interface StepQueue {
  push(e: QueuedStep): void
  /** 丟掉 time <= audible 的所有項目，回傳其中最後一個（目前可聽的拍）；沒有新項目時回傳 undefined */
  advance(audibleTime: number): QueuedStep | undefined
  clear(): void
  readonly size: number
}

export function createStepQueue(): StepQueue {
  let items: QueuedStep[] = []
  let head = 0
  return {
    push(e) {
      items.push(e)
    },
    advance(audibleTime) {
      let last: QueuedStep | undefined
      while (head < items.length && items[head]!.time <= audibleTime) last = items[head++]
      // 偶爾壓縮，避免陣列隨播放時間成長
      if (head > 32 && head * 2 > items.length) {
        items = items.slice(head)
        head = 0
      }
      return last
    },
    clear() {
      items = []
      head = 0
    },
    get size() {
      return items.length - head
    },
  }
}
