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

import { initialize, replaceAll, write } from '../src/data/database'

beforeEach(() => { vi.clearAllMocks() })

describe('安卓数据库调用参数', () => {
  it('空库启动时，版本与数据查询均显式传空参数数组', async () => {
    await expect(initialize()).resolves.toEqual(emptySnapshot())
    expect(sqlite.query.mock.calls.map(([options]) => options.statement)).toEqual([
      'PRAGMA user_version',
      'SELECT * FROM categories ORDER BY position',
      'SELECT * FROM entries ORDER BY date DESC,created_at DESC',
      'SELECT * FROM notes ORDER BY pinned DESC,position',
      "SELECT value FROM settings WHERE key='appearance'",
    ])
    for (const [options] of sqlite.query.mock.calls) expect(options.values).toEqual([])
  })

  it('整体恢复时，四条清空语句均传空数组并保留事务', async () => {
    await replaceAll(emptySnapshot())
    expect(sqlite.executeSet).toHaveBeenCalledOnce()
    const options = sqlite.executeSet.mock.calls[0][0]
    expect(options.transaction).toBe(true)
    expect(options.set.slice(0, 4)).toEqual([
      { statement: 'DELETE FROM entries', values: [] },
      { statement: 'DELETE FROM notes', values: [] },
      { statement: 'DELETE FROM categories', values: [] },
      { statement: 'DELETE FROM settings', values: [] },
    ])
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
})
