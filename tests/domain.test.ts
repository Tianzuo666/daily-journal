import { describe, expect, it } from 'vitest'
import { cents, emptySnapshot, filterEntries, groupEntriesByDay, orderedNotes, validDate, type Entry, type Note } from '../src/domain'
import { makeManifest, parseManifest } from '../src/backup-format'

const entry = (amountCents: number, overrides: Partial<Entry> = {}): Entry => ({ id: `entry-${amountCents}`, type: 'expense', amountCents, categoryId: 'expense-0', date: '2026-10-21', remark: '早餐', createdAt: 1, ...overrides })
const note = (overrides: Partial<Note> = {}): Note => ({ id: 'note-one', title: '周末', body: '散步', pinned: false, position: 0, todos: [], images: [], createdAt: 1, updatedAt: 1, ...overrides })

describe('金额与查询边界', () => {
  it('按整数分计算，避免小数累计误差', () => { expect(cents('0.1') + cents('0.20')).toBe(30); expect(cents('999999999.99')).toBe(99_999_999_999) })
  it('拒绝负数、超出两位的小数、科学计数及超限金额', () => { for (const value of ['-1', '1.001', '1e3', '1000000000', 'NaN', '']) expect(() => cents(value)).toThrow() })
  it('筛选含上下限、支持单边和精确金额，并对收支取正金额比较', () => {
    const entries = [entry(999), entry(1000), entry(2000), entry(2001, { type: 'income', categoryId: 'income-0' })]
    const filter = { from: '', to: '', type: '' as const, categoryIds: [] as string[], keyword: '', min: '10', max: '20' }
    expect(filterEntries(entries, filter).map(e => e.amountCents)).toEqual([1000, 2000])
    expect(filterEntries(entries, { ...filter, min: '', max: '10' })).toHaveLength(2)
    expect(filterEntries(entries, { ...filter, min: '20.01', max: '' })[0].type).toBe('income')
    expect(filterEntries(entries, { ...filter, min: '10', max: '10' })).toHaveLength(1)
    expect(() => filterEntries(entries, { ...filter, min: '21' })).toThrow()
  })
  it('拒绝不存在的日期，允许闰日', () => { expect(validDate('2026-02-30')).toBe(false); expect(validDate('2024-02-29')).toBe(true) })
  it('分类多选取并集，与日期、收支、金额和关键词同时满足；空选表示全部', () => {
    const entries = [entry(1000), entry(1500, { id: 'transport', categoryId: 'expense-1' }), entry(1600, { id: 'other', categoryId: 'expense-2' }), entry(1700, { id: 'income', type: 'income', categoryId: 'income-0' }), entry(1800, { id: 'old', date: '2026-09-30' }), entry(1900, { id: 'trash', deletedAt: 1 })]
    const filter = { from: '2026-10-01', to: '2026-10-31', type: 'expense' as const, categoryIds: ['expense-0', 'expense-1', 'income-0'], keyword: '早餐', min: '10', max: '20' }
    expect(filterEntries(entries, filter).map(e => e.id)).toEqual(['entry-1000', 'transport'])
    expect(filterEntries(entries, { ...filter, categoryIds: [] }).map(e => e.id)).toEqual(['entry-1000', 'transport', 'other'])
    expect(filterEntries(entries, { ...filter, keyword: '午餐' })).toEqual([])
    expect(filterEntries(entries, { ...filter, min: '14' }).map(e => e.id)).toEqual(['transport'])
  })
})
describe('账单按天分组', () => {
  it('按账单日期而非创建时间分组，日期倒序且同日最新创建的排前面', () => {
    const entries = [entry(100, { id: 'older', date: '2026-11-18', createdAt: 1 }), entry(50, { id: 'previous-year', date: '2025-12-31', createdAt: 100 }), entry(200, { id: 'newer', date: '2026-11-18', createdAt: 2 }), entry(300, { id: 'yesterday', date: '2026-11-17', createdAt: 99 })]
    const before = JSON.stringify(entries), groups = groupEntriesByDay(entries)
    expect(groups.map(group => group.date)).toEqual(['2026-11-18', '2026-11-17', '2025-12-31'])
    expect(groups[0].entries.map(item => item.id)).toEqual(['newer', 'older'])
    expect(JSON.stringify(entries)).toBe(before)
  })
  it('日小计按整数分分别汇总收支，收入不抵扣支出，排除回收站账单', () => {
    const groups = groupEntriesByDay([entry(10), entry(20), entry(1000, { type: 'income', categoryId: 'income-0' }), entry(500, { deletedAt: 1 })])
    expect(groups).toHaveLength(1); expect(groups[0]).toMatchObject({ expense: 30, income: 1000 }); expect(groups[0].entries).toHaveLength(3)
    expect(groupEntriesByDay([])).toEqual([])
  })
  it('分类、金额联合筛选后，日小计只包含当前可见账单', () => {
    const entries = [entry(100), entry(200, { categoryId: 'expense-1' }), entry(300, { categoryId: 'expense-2' }), entry(500, { categoryId: 'expense-1' })]
    const filter = { from: '2026-10-01', to: '2026-10-31', type: 'expense' as const, categoryIds: ['expense-0', 'expense-1'], keyword: '', min: '', max: '3' }
    expect(groupEntriesByDay(filterEntries(entries, filter))[0]).toMatchObject({ expense: 300, income: 0 })
  })
})

describe('备份恢复前的结构检查', () => {
  it('完整保留置顶、手动排序、待办与主题设置', () => {
    const data = emptySnapshot(); data.entries.push(entry(123)); data.notes.push(note({ pinned: true, position: 7, todos: [{ id: 'todo-one', text: '读书', done: true }] })); data.appearance.preset = 'custom'; data.appearance.accent = '#ffffff'
    expect(parseManifest(makeManifest(data)).data).toEqual(data)
  })
  it('拒绝未来版本、重复编号、缺失分类、非法金额和错误字段', () => {
    const base = JSON.parse(makeManifest(emptySnapshot()))
    const invalid = [
      { ...base, version: 999 },
      { ...base, data: { ...base.data, categories: [...base.data.categories, base.data.categories[0]] } },
      { ...base, data: { ...base.data, entries: [entry(1, { categoryId: 'missing' })] } },
      { ...base, data: { ...base.data, entries: [entry(-1)] } },
      { ...base, data: { ...base.data, notes: [note({ pinned: 1 as unknown as boolean })] } },
    ]
    invalid.forEach(value => expect(() => parseManifest(JSON.stringify(value))).toThrow())
  })
  it('拒绝图片路径越界及重复图片，避免进入原生恢复阶段', () => {
    const data = emptySnapshot(), image = { file: '../database.db', name: '照片', mime: 'image/jpeg', size: 1, sha256: 'a'.repeat(64) }
    data.notes.push(note({ images: [image] })); expect(() => makeManifest(data)).toThrow()
    image.file = '00000000-0000-4000-8000-000000000000.jpg'; data.notes[0].images = [image, { ...image }]; expect(() => makeManifest(data)).toThrow()
  })
})
describe('记录分组排序', () => {
  it('分别排序多个置顶和普通记录，搜索包含待办文字', () => {
    const notes = [note({ id: 'a', pinned: true, position: 5 }), note({ id: 'b', pinned: true, position: 1 }), note({ id: 'c', pinned: false, position: 0, todos: [{ id: 't', text: '交电费', done: false }] })]
    expect(orderedNotes(notes, true).map(n => n.id)).toEqual(['b', 'a'])
    expect(orderedNotes(notes, false, '电费').map(n => n.id)).toEqual(['c'])
  })
})
