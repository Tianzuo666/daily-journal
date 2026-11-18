import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { emptySnapshot, type Entry, type RecurringRule } from '../src/domain'

const storage = vi.hoisted(() => ({ write: vi.fn(async (_statements: unknown[]) => {}), replaceAll: vi.fn(async (_data: unknown) => {}), backup: vi.fn(async () => ({ path: '/backups/protection.zip', name: 'protection.zip', size: 1, createdAt: 1 })) }))
vi.mock('../src/native', () => ({ native: true, files: { createBackup: storage.backup, info: async () => ({ imageDirectory: '/images', backups: [] }), removeImages: async () => ({}) } }))
vi.mock('../src/data/database', async () => {
  const actual = await vi.importActual<typeof import('../src/data/database')>('../src/data/database')
  return { ...actual, write: storage.write, replaceAll: storage.replaceAll, saveDevice: async () => {}, readDevice: async () => ({}) }
})
import { useJournal } from '../src/stores/journal'

const entry = (id: string): Entry => ({ id, type: 'expense', categoryId: 'expense-0', amountCents: 100, date: '2026-11-17', remark: '', createdAt: 1 })
const rule: RecurringRule = { id: 'rule', name: '房租', type: 'expense', categoryId: 'expense-0', amountCents: 100, remark: '', firstDate: '2026-11-17', resumeFrom: '2026-11-17', endDate: '', enabled: true, frequency: 'month' }
beforeEach(() => { setActivePinia(createPinia()); storage.write.mockReset(); storage.write.mockResolvedValue(undefined); storage.replaceAll.mockReset(); storage.replaceAll.mockResolvedValue(undefined); storage.backup.mockReset(); storage.backup.mockResolvedValue({ path: '/backups/protection.zip', name: 'protection.zip', size: 1, createdAt: 1 }); vi.stubGlobal('window', { dispatchEvent: vi.fn() }) })

describe('二期事务与串行状态', () => {
  it('同一期同时确认两次，只有一次入账且账单和期次同批写入', async () => {
    const store = useJournal(); store.data.rules = [{ ...rule }]; store.data.occurrences = [{ id: 'period', ruleId: rule.id, dueDate: rule.firstDate, name: rule.name, type: rule.type, amountCents: rule.amountCents, categoryId: rule.categoryId, remark: '', state: 'pending' }]
    const results = await Promise.allSettled([store.saveEntry(entry('one'), 'period'), store.saveEntry(entry('two'), 'period')])
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected']); expect(store.data.entries).toHaveLength(1)
    expect(store.data.occurrences[0]).toMatchObject({ state: 'confirmed', entryId: 'one' }); expect(storage.write).toHaveBeenCalledOnce()
    expect(storage.write.mock.calls[0][0]).toHaveLength(2)
  })
  it('入账事务失败时，保留待确认状态和原内存内容', async () => {
    const store = useJournal(); const before = JSON.stringify(store.data); storage.write.mockRejectedValueOnce(new Error('disk full'))
    await expect(store.saveEntry(entry('one'))).rejects.toThrow('disk full'); expect(JSON.stringify(store.data)).toBe(before)
  })
  it('合并迁移正常和回收站账单、规则、历史期次、最近分类，金额不变', async () => {
    const store = useJournal(); store.data = emptySnapshot(); store.data.entries = [entry('active'), { ...entry('trashed'), deletedAt: 1 }]; store.data.rules = [{ ...rule }]
    store.data.occurrences = [{ id: 'period', ruleId: rule.id, dueDate: rule.firstDate, name: rule.name, type: rule.type, categoryId: rule.categoryId, amountCents: 100, remark: '', state: 'confirmed', entryId: 'active' }]; store.data.recent.expense = ['expense-0','expense-1']
    await store.mergeCategory('expense-0', 'expense-1')
    expect(storage.backup).toHaveBeenCalledOnce(); expect(storage.replaceAll).toHaveBeenCalledOnce(); expect(store.data.categories.some(c => c.id === 'expense-0')).toBe(false)
    expect([...store.data.entries, ...store.data.rules, ...store.data.occurrences].every(item => item.categoryId === 'expense-1')).toBe(true)
    expect(store.data.entries.map(e => e.amountCents)).toEqual([100,100]); expect(store.data.entries[1].deletedAt).toBe(1); expect(store.data.occurrences[0].state).toBe('confirmed'); expect(store.data.recent.expense).toEqual(['expense-1'])
  })
  it('保护备份失败时不执行合并事务，不改变原分类', async () => {
    const store = useJournal(); const before = JSON.stringify(store.data); storage.backup.mockRejectedValueOnce(new Error('backup failed'))
    await expect(store.mergeCategory('expense-0','expense-1')).rejects.toThrow('backup failed'); expect(storage.replaceAll).not.toHaveBeenCalled(); expect(JSON.stringify(store.data)).toBe(before)
  })
  it('年付改为月付时，不补出修改日前的月付期次', async () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 17, 12) })
    try {
      const store = useJournal(), old = { ...rule, frequency: 'year' as const, firstDate: '2025-11-17', resumeFrom: '2025-11-17' }
      store.data.rules = [old]
      await store.saveRule({ ...old, frequency: 'month' })
      expect(store.data.occurrences.map(o => o.dueDate)).toEqual(['2025-11-17', '2026-11-17'])
      expect(store.data.rules[0].resumeFrom).toBe('2026-11-17')
    } finally { vi.useRealTimers() }
  })
})
