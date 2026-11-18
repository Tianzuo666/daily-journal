import { CapacitorSQLite } from '@capacitor-community/sqlite'
import { emptySnapshot, localDate, type Snapshot, type Entry, type Note, type Category, type Appearance, type LedgerFilter, cents, filterEntries } from '../domain'
import { native } from '../native'

const database = 'daily_journal'
let connectionCreated = false, opened = false
export interface Statement { statement: string; values?: (string | number | null)[] }
const schema = `
CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY,type TEXT NOT NULL,name TEXT NOT NULL,position INTEGER NOT NULL,UNIQUE(type,name));
CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY,type TEXT NOT NULL,amount_cents INTEGER NOT NULL CHECK(amount_cents>0),category_id TEXT NOT NULL REFERENCES categories(id),date TEXT NOT NULL,remark TEXT NOT NULL,created_at INTEGER NOT NULL,images TEXT NOT NULL DEFAULT '[]',deleted_at INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS entry_date_amount ON entries(date,amount_cents);
CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,todos TEXT NOT NULL,images TEXT NOT NULL,pinned INTEGER NOT NULL DEFAULT 0,position INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,record_date TEXT NOT NULL,tag_ids TEXT NOT NULL DEFAULT '[]',deleted_at INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS note_order ON notes(pinned,position);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
PRAGMA user_version=2;`
export const categoryStatement = (c: Category): Statement => ({ statement: 'INSERT INTO categories(id,type,name,position) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,position=excluded.position', values: [c.id, c.type, c.name, c.position] })
export const entryStatement = (e: Entry): Statement => ({ statement: 'INSERT OR REPLACE INTO entries(id,type,amount_cents,category_id,date,remark,created_at,images,deleted_at) VALUES(?,?,?,?,?,?,?,?,?)', values: [e.id, e.type, e.amountCents, e.categoryId, e.date, e.remark, e.createdAt, JSON.stringify(e.images ?? []), e.deletedAt ?? 0] })
export const noteStatement = (n: Note): Statement => ({ statement: 'INSERT OR REPLACE INTO notes(id,title,body,todos,images,pinned,position,created_at,updated_at,record_date,tag_ids,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', values: [n.id, n.title, n.body, JSON.stringify(n.todos), JSON.stringify(n.images), Number(n.pinned), n.position, n.createdAt, n.updatedAt, n.recordDate ?? localDate(new Date(n.createdAt)), JSON.stringify(n.tagIds ?? []), n.deletedAt ?? 0] })
const setting = (key: string, value: unknown): Statement => ({ statement: 'INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)', values: [key, JSON.stringify(value)] })
export const appearanceStatement = (value: Appearance) => setting('appearance', value)
export const metaStatement = (s: Snapshot) => setting('content_v2', { tags: s.tags, budgets: s.budgets, rules: s.rules, occurrences: s.occurrences, recent: s.recent })
export async function write(statements: Statement[]): Promise<void> {
  // 原生层要求无占位参数的语句也显式带空数组。
  if (native && statements.length) await CapacitorSQLite.executeSet({ database, set: statements.map(s => ({ ...s, values: s.values ?? [] })), transaction: true })
}
function fromRow(row: Record<string, unknown>): Entry {
  return { id: String(row.id), type: row.type as Entry['type'], amountCents: Number(row.amount_cents), categoryId: String(row.category_id), date: String(row.date), remark: String(row.remark), createdAt: Number(row.created_at), images: JSON.parse(String(row.images ?? '[]')), deletedAt: Number(row.deleted_at ?? 0) }
}
export async function initialize(): Promise<Snapshot> {
  if (!native) return emptySnapshot()
  if (!connectionCreated) { await CapacitorSQLite.createConnection({ database, version: 2, encrypted: false, mode: 'no-encryption', readonly: false }); connectionCreated = true }
  if (!opened) { await CapacitorSQLite.open({ database, readonly: false }); opened = true }
  await CapacitorSQLite.execute({ database, statements: 'PRAGMA foreign_keys=ON;', transaction: false })
  const version = Number((await CapacitorSQLite.query({ database, statement: 'PRAGMA user_version', values: [] })).values?.[0]?.user_version ?? 0)
  if (version > 2) throw new Error('数据库来自较新版本，请升级应用')
  if (version === 1) {
    const oldNotes = (await CapacitorSQLite.query({ database, statement: 'SELECT id,created_at FROM notes', values: [] })).values ?? []
    // 增量迁移与日期回填在同一事务内完成，失败不留下半迁移状态。
    await write([
      { statement: "ALTER TABLE entries ADD COLUMN images TEXT NOT NULL DEFAULT '[]'" }, { statement: 'ALTER TABLE entries ADD COLUMN deleted_at INTEGER NOT NULL DEFAULT 0' },
      { statement: "ALTER TABLE notes ADD COLUMN record_date TEXT NOT NULL DEFAULT ''" }, { statement: "ALTER TABLE notes ADD COLUMN tag_ids TEXT NOT NULL DEFAULT '[]'" }, { statement: 'ALTER TABLE notes ADD COLUMN deleted_at INTEGER NOT NULL DEFAULT 0' },
      ...oldNotes.map((n: Record<string, unknown>) => ({ statement: 'UPDATE notes SET record_date=? WHERE id=?', values: [localDate(new Date(Number(n.created_at))), String(n.id)] })), { statement: 'PRAGMA user_version=2' },
    ])
  }
  if (version === 0) await CapacitorSQLite.execute({ database, statements: schema, transaction: true })
  const [cats, entries, notes, settings] = await Promise.all([
    CapacitorSQLite.query({ database, statement: 'SELECT * FROM categories ORDER BY position', values: [] }),
    CapacitorSQLite.query({ database, statement: 'SELECT * FROM entries ORDER BY date DESC,created_at DESC', values: [] }),
    CapacitorSQLite.query({ database, statement: 'SELECT * FROM notes ORDER BY pinned DESC,position', values: [] }),
    CapacitorSQLite.query({ database, statement: "SELECT key,value FROM settings WHERE key IN ('appearance','content_v2')", values: [] }),
  ])
  const defaults = emptySnapshot(), config = new Map<string, unknown>((settings.values ?? []).map((s: { key: string; value: string }): [string, unknown] => [s.key, JSON.parse(s.value)]))
  if (!cats.values?.length) await write(defaults.categories.map(categoryStatement))
  return { ...defaults, ...((config.get('content_v2') as Partial<Snapshot>) ?? {}),
    categories: cats.values?.length ? cats.values.map((c: Record<string, unknown>) => ({ id: String(c.id), type: c.type as Category['type'], name: String(c.name), position: Number(c.position) })) : defaults.categories,
    entries: (entries.values ?? []).map(fromRow),
    notes: (notes.values ?? []).map((n: Record<string, unknown>) => ({ id: String(n.id), title: String(n.title), body: String(n.body), todos: JSON.parse(String(n.todos)), images: JSON.parse(String(n.images)), pinned: Number(n.pinned) === 1, position: Number(n.position), createdAt: Number(n.created_at), updatedAt: Number(n.updated_at), recordDate: String(n.record_date), tagIds: JSON.parse(String(n.tag_ids)), deletedAt: Number(n.deleted_at) })),
    appearance: (config.get('appearance') as Appearance) ?? defaults.appearance,
  }
}
export async function findEntries(filter: LedgerFilter, preview: Entry[]): Promise<Entry[]> {
  if (!native) return filterEntries(preview, filter)
  const clauses: string[] = ['deleted_at=0'], values: (string | number)[] = []
  for (const [condition, value] of [['date>=?', filter.from], ['date<=?', filter.to], ['type=?', filter.type]] as const) if (value) { clauses.push(condition); values.push(value) }
  // 同一维度内分类取并集，仍与日期、类型和金额等其他条件取交集。
  const categories = [...new Set(filter.categoryIds)]
  if (categories.length) { clauses.push(`category_id IN (${categories.map(() => '?').join(',')})`); values.push(...categories) }
  if (filter.min.trim()) { clauses.push('amount_cents>=?'); values.push(cents(filter.min, true)) }
  if (filter.max.trim()) { clauses.push('amount_cents<=?'); values.push(cents(filter.max, true)) }
  if (filter.keyword.trim()) { clauses.push('instr(lower(remark),lower(?))>0'); values.push(filter.keyword.trim()) }
  return ((await CapacitorSQLite.query({ database, statement: `SELECT * FROM entries WHERE ${clauses.join(' AND ')} ORDER BY date DESC,created_at DESC`, values })).values ?? []).map(fromRow)
}
export async function replaceAll(snapshot: Snapshot): Promise<void> {
  await write([{ statement: 'DELETE FROM entries' }, { statement: 'DELETE FROM notes' }, { statement: 'DELETE FROM categories' }, ...snapshot.categories.map(categoryStatement), ...snapshot.entries.map(entryStatement), ...snapshot.notes.map(noteStatement), appearanceStatement(snapshot.appearance), metaStatement(snapshot)])
}
// 设备提醒/导出时间不属于内容备份，整体恢复不改写这些信息。
export async function readDevice(): Promise<Record<string, number | boolean | string>> {
  if (!native) return {}
  const rows = await CapacitorSQLite.query({ database, statement: "SELECT value FROM settings WHERE key='device_v2'", values: [] })
  return rows.values?.[0] ? JSON.parse(rows.values[0].value) : {}
}
export const saveDevice = (value: Record<string, number | boolean | string>) => write([setting('device_v2', value)])
