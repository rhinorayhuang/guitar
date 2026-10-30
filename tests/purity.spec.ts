import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 播放時鐘／節拍器的靜態掃描（metronome-architecture.md §2、§9.3）。
 * 調音器的既有掃描在 tests/tuner/purity.spec.ts，維持不變；這裡套用同一套規則到 clock/、metronome/，
 * 另外強制 PA-08 與 audio/ 的依賴方向。
 */
const ROOT = fileURLToPath(new URL('../', import.meta.url))
const APP = join(ROOT, 'app')
const PURE_DIRS = ['tuner', 'clock', 'metronome'].map(d => join(APP, 'utils', d))
const TIMER_FREE_DIRS = ['clock', 'metronome'].map(d => join(APP, 'utils', d))
const AUDIO = join(APP, 'composables', 'audio')
const SCHEDULER = join(AUDIO, 'scheduler.ts')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

const sourceFiles = (dir: string) => walk(dir).filter(p => /\.(ts|vue|js|mjs)$/.test(p))
const read = (p: string) => readFileSync(p, 'utf8')
/** 去掉註解，避免說明文字誤判 */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const cases = (dirs: string[]) => dirs.flatMap(sourceFiles).map(p => [relative(ROOT, p), p] as const)

describe('purity: app/utils/{tuner,clock,metronome}', () => {
  it('clock/ and metronome/ exist and have files', () => {
    expect(sourceFiles(join(APP, 'utils', 'clock')).length).toBeGreaterThanOrEqual(5)
    expect(sourceFiles(join(APP, 'utils', 'metronome')).length).toBeGreaterThanOrEqual(3)
  })

  it.each(cases(PURE_DIRS))('%s does not import vue / #imports / #app', (_, p) => {
    const src = stripComments(read(p))
    expect(src).not.toMatch(/from\s+['"](vue|#imports|#app|nuxt\/app|@vue\/[^'"]+)['"]/)
    expect(src).not.toMatch(/import\s*\(\s*['"](vue|#imports|#app)['"]\s*\)/)
  })

  it.each(cases(PURE_DIRS))('%s does not touch browser globals', (_, p) => {
    const src = stripComments(read(p))
    expect(src).not.toMatch(/\b(window|navigator|document)\s*\./)
    expect(src).not.toMatch(/\blocalStorage\b/)
    expect(src).not.toMatch(/\bAudioContext\b/)
    expect(src).not.toMatch(/\b(Date\.now|performance\.now)\s*\(/)
  })

  it.each(cases(TIMER_FREE_DIRS))('%s uses no timers or rAF (time is always passed in)', (_, p) => {
    expect(stripComments(read(p))).not.toMatch(/\b(setTimeout|setInterval|requestAnimationFrame)\b/)
  })

  it('clock/ does not depend on metronome/', () => {
    for (const p of sourceFiles(join(APP, 'utils', 'clock'))) expect(read(p), relative(ROOT, p)).not.toMatch(/metronome\//)
  })
})

describe('PA-08: setInterval only in the scheduler', () => {
  it('app/ uses setInterval only in app/composables/audio/scheduler.ts', () => {
    const offenders = sourceFiles(APP).filter(p => p !== SCHEDULER && /\bsetInterval\b/.test(read(p)))
    expect(offenders.map(p => relative(ROOT, p))).toEqual([])
    expect(read(SCHEDULER)).toMatch(/\bsetInterval\b/)
  })

  it('the scheduler never creates or starts audio nodes', () => {
    expect(stripComments(read(SCHEDULER))).not.toMatch(/createOscillator|createBufferSource|\.start\(/)
  })
})

describe('app/composables/audio is reusable (§2)', () => {
  it.each(cases([AUDIO]))('%s does not import vue, metronome/ or tuner/', (_, p) => {
    const src = stripComments(read(p))
    expect(src).not.toMatch(/from\s+['"](vue|#imports|#app|@vue\/[^'"]+)['"]/)
    expect(src).not.toMatch(/from\s+['"][^'"]*\/(metronome|tuner)\/[^'"]*['"]/)
  })
})
