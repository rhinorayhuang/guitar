// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import FingerCareNotice from '~/components/FingerCareNotice.vue'
import { fingerCare } from '~/data/finger-care'
import { practicePlan } from '~/data/practice-plan'

const ONE_TO_THREE_WEEKS = /1\s*[–\-~到至]\s*3\s*週/

describe('P0-5 / Story 5: finger care notice', () => {
  const mountNotice = (minutes = 15) => mount(FingerCareNotice, { props: { minutes } })

  // 收合時仍可見的部分：摘要 + 停止訊號（happy-dom 不套用媒體查詢，這裡驗的是手機的收合狀態）
  it('always shows a summary with "1–3 weeks is normal" and the current stage\'s daily minutes', () => {
    const summary = mountNotice(15).find('[data-testid="finger-care-summary"]').text()
    expect(summary).toMatch(ONE_TO_THREE_WEEKS)
    expect(summary).toContain('15 分鐘')
    for (const s of practicePlan) expect(fingerCare.summary(s.dailyMinutes), s.id).toContain(`${s.dailyMinutes}`)
  })

  it('always shows the stop signs (numbness, sharp pain, joint pain) outside the collapsible part', () => {
    const w = mountNotice()
    const stop = w.find('[data-testid="finger-care-stop"]')
    for (const keyword of ['麻', '刺痛', '關節']) expect(stop.text()).toContain(keyword)
    expect(stop.text()).toContain(fingerCare.stopAction)
    expect(w.find('[data-testid="finger-care-more"]').element.contains(stop.element)).toBe(false)
  })

  it('collapses the rest on mobile and expands it with an accessible toggle', async () => {
    const w = mountNotice()
    const toggle = w.find('[data-testid="finger-care-toggle"]')
    const more = w.find('[data-testid="finger-care-more"]')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(toggle.attributes('aria-controls')).toBe(more.attributes('id'))
    expect(more.classes()).not.toContain('open')

    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(more.classes()).toContain('open')
    expect(more.text()).toContain(fingerCare.normal)
    expect(more.text()).toContain(fingerCare.dailyPractice(15))
    for (const tip of fingerCare.tips) expect(more.text()).toContain(tip)
  })

  it('is a labelled section', () => {
    const w = mountNotice(10)
    expect(w.find('section').attributes('aria-labelledby')).toBe('finger-care-title')
    expect(w.find('#finger-care-title').text()).toBe(fingerCare.title)
  })
})
