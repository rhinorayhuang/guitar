import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** 靜態掃描（TUN-80、TUN-01、ADR-003 純度規則） */
const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const APP = join(ROOT, 'app')
const TUNER_UTILS = join(APP, 'utils', 'tuner')

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

describe('purity scans', () => {
  it('app/utils/tuner exists and has files', () => {
    expect(sourceFiles(TUNER_UTILS).length).toBeGreaterThanOrEqual(10)
  })

  it.each(sourceFiles(TUNER_UTILS).map(p => [relative(ROOT, p), p]))('%s does not import vue / #imports / #app', (_, p) => {
    const src = stripComments(read(p))
    expect(src).not.toMatch(/from\s+['"](vue|#imports|#app|nuxt\/app|@vue\/[^'"]+)['"]/)
    expect(src).not.toMatch(/import\s*\(\s*['"](vue|#imports|#app)['"]\s*\)/)
  })

  it.each(sourceFiles(TUNER_UTILS).map(p => [relative(ROOT, p), p]))('%s does not touch browser globals', (_, p) => {
    const src = stripComments(read(p))
    expect(src).not.toMatch(/\b(window|navigator|document)\s*\./)
    expect(src).not.toMatch(/\blocalStorage\b/)
    expect(src).not.toMatch(/\bAudioContext\b/)
    expect(src).not.toMatch(/\b(Date\.now|performance\.now)\s*\(/)
  })

  it('TUN-80: app/ never uses MediaRecorder', () => {
    for (const p of sourceFiles(APP)) expect(read(p), relative(ROOT, p)).not.toMatch(/MediaRecorder/)
  })

  it('TUN-01: app/ has no hard-coded string frequency table', () => {
    for (const p of sourceFiles(APP)) {
      for (const lit of ['82.41', '146.83', '196.00', '246.94', '329.63']) expect(read(p), `${relative(ROOT, p)}: ${lit}`).not.toContain(lit)
    }
  })
})
