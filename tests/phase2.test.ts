import { describe, expect, it } from 'vitest'
import { emptySnapshot, generateOccurrences, localDate, recurringDates, type RecurringRule } from '../src/domain'
import { makeManifest, parseManifest } from '../src/backup-format'

const rule = (overrides: Partial<RecurringRule> = {}): RecurringRule => ({ id: 'rule-one', name: '房租', type: 'expense', amountCents: 10000, categoryId: 'expense-0', remark: '', firstDate: '2024-01-31', resumeFrom: '2024-01-31', frequency: 'month', endDate: '', enabled: true, ...overrides })

describe('周期日期和防重复', () => {
  it('月末始终用原日期锚点，不从二月末漂移到三月末之前', () => { expect(recurringDates(rule(), '2024-04-30')).toEqual(['2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30']) })
  it('年度闰日非闰年取二月末，闰年恢复二十九日', () => { expect(recurringDates(rule({ frequency: 'year', firstDate: '2024-02-29', resumeFrom: '2024-02-29' }), '2028-02-29')).toEqual(['2024-02-29','2025-02-28','2026-02-28','2027-02-28','2028-02-29']) })
  it('恢复启用后不补暂停期间的期次；跳过和已入账不再生成', () => {
    const data = emptySnapshot(); data.rules.push(rule({ resumeFrom: '2024-03-15' }))
    const additions = generateOccurrences(data, '2024-04-30'); expect(additions.map(o => o.dueDate)).toEqual(['2024-03-31', '2024-04-30'])
    data.occurrences = additions.map((o, index) => ({ ...o, state: index ? 'confirmed' : 'skipped', ...(index ? { entryId: 'deleted-entry' } : {}) }))
    expect(generateOccurrences(data, '2024-04-30')).toEqual([])
  })
})
describe('完整备份兼容', () => {
  it('读取一期备份补齐二期字段，并保留历史日期、排序和原内容', () => {
    const createdAt = new Date(2024, 1, 29, 23, 30).getTime(), data = emptySnapshot()
    const raw = JSON.stringify({ format: 'daily-journal', version: 1, createdAt: 1, data: { categories: data.categories, entries: [], notes: [{ id: 'note', title: '旧内容', body: '正文', todos: [], images: [], pinned: true, position: 5, createdAt, updatedAt: createdAt }], appearance: data.appearance } })
    const parsed = parseManifest(raw).data
    expect(parsed.notes[0]).toMatchObject({ title: '旧内容', position: 5, pinned: true, recordDate: localDate(new Date(createdAt)), tagIds: [] })
    expect(parsed.budgets).toEqual([]); expect(parsed.rules).toEqual([]); expect(parsed.recent).toEqual({ income: [], expense: [] })
  })
  it('旧二期预算字段仍可往返兼容，周期及回收站引用继续校验', () => {
    const data = emptySnapshot(); data.rules = [rule()]; data.occurrences = generateOccurrences(data, '2024-01-31'); data.budgets = [{ month: '2026-11', amountCents: 300000 }]
    data.entries = [{ id: 'trash', type: 'expense', amountCents: 10, categoryId: 'expense-0', date: '2026-11-01', remark: '', createdAt: 1, deletedAt: 2 }]
    expect(parseManifest(makeManifest(data)).data).toEqual(data)
    data.occurrences.push({ ...data.occurrences[0], id: 'duplicate' }); expect(() => makeManifest(data)).toThrow()
    data.occurrences.pop(); data.rules[0].categoryId = 'missing'; expect(() => makeManifest(data)).toThrow()
  })
})
