import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptySnapshot } from '../src/domain'

const sqlite = vi.hoisted(() => ({
  createConnection: vi.fn(async () => ({})),
  open: vi.fn(async () => ({})),
  execute: vi.fn(async () => ({})),
  query: vi.fn(async ({ statement, values }: { statement: string; values?: unknown[] }) => {
    // 模拟安卓原生插件的参数要求，避免可选类型掩盖启动失败。
    if (!Array.isArray(values)) throw new Error('Query: Must provide an Array of Strings')
    return { values: statement === 'PRAGMA user_version' ? [{ user_version: 1 }] : [] }
  }),
  executeSet: vi.fn(async ({ set }: { set: { statement: string; values?: unknown[] }[]; transaction: boolean; database: string }) => {
    for (const row of set) if (!Array.isArray(row.values)) throw new Error('ExecuteSet: missing values')
    return { changes: { changes: 0 } }
  }),
}))

vi.mock('@capacitor-community/sqlite', () => ({ CapacitorSQLite: sqlite }))
vi.mock('../src/native', () => ({ native: true }))

import { findEntries, initialize, replaceAll, write } from '../src/data/database'

beforeEach(() => { vi.clearAllMocks() })

describe('安卓数据库调用参数', () => {
  it('一期库迁移启动时，版本与数据查询均显式传空参数数组', async () => {
    await expect(initialize()).resolves.toEqual(emptySnapshot())
    expect(sqlite.query.mock.calls.map(([options]) => options.statement)).toEqual([
      'PRAGMA user_version',
      'SELECT id,created_at FROM notes',
      'SELECT * FROM categories ORDER BY position',
      'SELECT * FROM entries ORDER BY date DESC,created_at DESC',
      'SELECT * FROM notes ORDER BY pinned DESC,position',
      "SELECT key,value FROM settings WHERE key IN ('appearance','content_v2')",
    ])
    for (const [options] of sqlite.query.mock.calls) expect(options.values).toEqual([])
  })

  it('整体恢复的清空语句带空数组并保留事务，不清空设备设置', async () => {
    await replaceAll(emptySnapshot())
    expect(sqlite.executeSet).toHaveBeenCalledOnce()
    const options = sqlite.executeSet.mock.calls[0][0]
    expect(options.transaction).toBe(true)
    expect(options.set.slice(0, 3)).toEqual([
      { statement: 'DELETE FROM entries', values: [] },
      { statement: 'DELETE FROM notes', values: [] },
      { statement: 'DELETE FROM categories', values: [] },
    ])
    expect(options.set.some(s => s.statement === 'DELETE FROM settings')).toBe(false)
  })

  it('补空数组时保留已有绑定参数，不修改传入语句', async () => {
    const statements = [{ statement: 'DELETE FROM notes' }, { statement: 'DELETE FROM entries WHERE id=?', values: ['entry-one'] }]
    await write(statements)
    expect(sqlite.executeSet).toHaveBeenCalledWith({
      database: 'daily_journal', transaction: true,
      set: [{ statement: 'DELETE FROM notes', values: [] }, { statement: 'DELETE FROM entries WHERE id=?', values: ['entry-one'] }],
    })
    expect(statements[0]).not.toHaveProperty('values')
  })
  it('多选分类使用绑定参数IN查询，空选不附加分类限制', async () => {
    const filter = { from: '2026-11-01', to: '2026-11-30', type: 'expense' as const, categoryIds: ['expense-0', "category'quote", 'expense-0'], keyword: '早餐', min: '1', max: '20' }
    await findEntries(filter, [])
    expect(sqlite.query).toHaveBeenLastCalledWith({ database: 'daily_journal', statement: 'SELECT * FROM entries WHERE deleted_at=0 AND date>=? AND date<=? AND type=? AND category_id IN (?,?) AND amount_cents>=? AND amount_cents<=? AND instr(lower(remark),lower(?))>0 ORDER BY date DESC,created_at DESC', values: ['2026-11-01', '2026-11-30', 'expense', 'expense-0', "category'quote", 100, 2000, '早餐'] })
    await findEntries({ ...filter, categoryIds: [], keyword: '', min: '', max: '' }, [])
    expect(sqlite.query).toHaveBeenLastCalledWith({ database: 'daily_journal', statement: 'SELECT * FROM entries WHERE deleted_at=0 AND date>=? AND date<=? AND type=? ORDER BY date DESC,created_at DESC', values: ['2026-11-01', '2026-11-30', 'expense'] })
  })
})
