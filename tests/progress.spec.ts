import { describe, expect, it } from 'vitest'
import { practicePlan } from '~/data/practice-plan'
import {
  PROGRESS_VERSION, createBackup, currentStageId, emptyProgress, importBackup, isStageCompleted, parseProgress, serializeProgress,
  setStageCompleted,
} from '~/utils/progress'

const NOW = new Date('2026-10-28T12:00:00Z')

describe('P0-4 / PA-05: progress data', () => {
  it('round-trips through JSON with a version and a `stages` namespace', () => {
    const data = setStageCompleted(emptyProgress(), 'stage-1', true, NOW)
    const raw = serializeProgress(data)
    expect(JSON.parse(raw)).toEqual({ v: PROGRESS_VERSION, stages: { 'stage-1': { completedAt: '2026-10-28T12:00:00.000Z' } } })
    expect(parseProgress(raw)).toEqual(data)
  })

  it.each([
    ['null', null],
    ['empty string', ''],
    ['broken JSON', '{"v":1,'],
    ['an array', '[]'],
    ['an unknown version', '{"v":2,"stages":{}}'],
    ['missing stages', '{"v":1}'],
  ])('falls back to empty progress for %s', (_, raw) => {
    expect(parseProgress(raw)).toEqual(emptyProgress())
  })

  it('drops malformed stage entries but keeps the valid ones', () => {
    const raw = JSON.stringify({ v: 1, stages: { 'stage-1': { completedAt: 'x' }, 'stage-2': true, 'stage-3': {} } })
    expect(Object.keys(parseProgress(raw).stages)).toEqual(['stage-1'])
  })

  it('keeps future namespaces out of `stages` (adding e.g. `theory` later needs no migration)', () => {
    const raw = JSON.stringify({ v: 1, stages: { 'stage-1': { completedAt: 'x' } }, theory: { anything: 1 } })
    expect(parseProgress(raw).stages).toEqual({ 'stage-1': { completedAt: 'x' } })
  })

  it('is immutable, keeps the first completion time, and can undo a single stage', () => {
    const a = setStageCompleted(emptyProgress(), 'stage-2', true, NOW)
    const b = setStageCompleted(a, 'stage-2', true, new Date('2027-01-01T00:00:00Z'))
    expect(b.stages['stage-2']!.completedAt).toBe(a.stages['stage-2']!.completedAt)
    const c = setStageCompleted(b, 'stage-2', false, NOW)
    expect(isStageCompleted(c, 'stage-2')).toBe(false)
    expect(isStageCompleted(a, 'stage-2')).toBe(true)
  })
})

describe('Story 4: current stage', () => {
  const doneThrough = (...ids: string[]) => ids.reduce((d, id) => setStageCompleted(d, id, true, NOW), emptyProgress())

  it('is the first stage when nothing is done', () => {
    expect(currentStageId(practicePlan, emptyProgress())).toBe('stage-1')
  })

  it('is the first incomplete stage, without forcing order', () => {
    expect(currentStageId(practicePlan, doneThrough('stage-1', 'stage-2'))).toBe('stage-3')
    // 跳關：直接完成第 3 關，目前關卡仍是第一個未完成的第 1 關
    expect(currentStageId(practicePlan, doneThrough('stage-3'))).toBe('stage-1')
  })

  it('is null when every stage is done', () => {
    expect(currentStageId(practicePlan, doneThrough(...practicePlan.map(s => s.id)))).toBeNull()
  })
})

describe('D-07: backup export / import (merge, never overwrite)', () => {
  const done = (...ids: [string, string][]) => ({ v: PROGRESS_VERSION, stages: Object.fromEntries(ids.map(([id, at]) => [id, { completedAt: at }])) }) as ReturnType<typeof emptyProgress>

  it('exports a tagged, dated file that round-trips', () => {
    const data = done(['stage-1', '2026-10-01T00:00:00.000Z'])
    const { filename, json } = createBackup(data, NOW)
    expect(filename).toBe('guitar-progress-2026-10-28.json')
    expect(JSON.parse(json)).toMatchObject({ app: 'guitar-learning', exportedAt: NOW.toISOString(), progress: data })
    const r = importBackup(emptyProgress(), json)
    expect(r).toEqual({ ok: true, progress: data, added: 1 })
  })

  it('merges: keeps stages only on either side and the earlier completion time when both have it', () => {
    const current = done(['stage-1', '2026-10-05T00:00:00.000Z'], ['stage-3', '2026-10-06T00:00:00.000Z'])
    const backup = createBackup(done(['stage-1', '2026-10-01T00:00:00.000Z'], ['stage-2', '2026-10-02T00:00:00.000Z']), NOW).json
    const r = importBackup(current, backup)
    expect(r.ok && r.added).toBe(1)
    expect(r.ok && r.progress.stages).toEqual({
      'stage-1': { completedAt: '2026-10-01T00:00:00.000Z' },
      'stage-2': { completedAt: '2026-10-02T00:00:00.000Z' },
      'stage-3': { completedAt: '2026-10-06T00:00:00.000Z' },
    })
  })

  it.each([
    ['broken JSON', '{', 'invalid-json'],
    ['a raw progress object (not a backup)', JSON.stringify({ v: 1, stages: {} }), 'not-a-backup'],
    ['another app\'s file', JSON.stringify({ app: 'other', progress: { v: 1, stages: {} } }), 'not-a-backup'],
    ['a future version', JSON.stringify({ app: 'guitar-learning', progress: { v: 2, stages: {} } }), 'unsupported-version'],
  ])('rejects %s without touching current progress', (_, text, reason) => {
    expect(importBackup(done(['stage-1', 'x']), text)).toEqual({ ok: false, reason })
  })
})
