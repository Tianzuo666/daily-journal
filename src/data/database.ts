import { CapacitorSQLite } from '@capacitor-community/sqlite'
import { emptySnapshot, type Snapshot, type Entry, type Note, type Category, type Appearance, type LedgerFilter, cents, filterEntries } from '../domain'
import { native } from '../native'

const database = 'daily_journal'
let connectionCreated = false, opened = false
export interface Statement { statement: string; values?: (string | number | null)[] }
const schema = `
  CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('expense','income')), name TEXT NOT NULL, position INTEGER NOT NULL, UNIQUE(type,name));
  CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('expense','income')), amount_cents INTEGER NOT NULL CHECK(amount_cents>0), category_id TEXT NOT NULL REFERENCES categories(id), date TEXT NOT NULL, remark TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS entry_date_amount ON entries(date,amount_cents);
  CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, todos TEXT NOT NULL, images TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS note_order ON notes(pinned,position);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  PRAGMA user_version=1;
`

export const categoryStatement = (c: Category): Statement => ({ statement: 'INSERT OR REPLACE INTO categories(id,type,name,position) VALUES(?,?,?,?)', values: [c.id, c.type, c.name, c.position] })
export const entryStatement = (e: Entry): Statement => ({ statement: 'INSERT OR REPLACE INTO entries(id,type,amount_cents,category_id,date,remark,created_at) VALUES(?,?,?,?,?,?,?)', values: [e.id, e.type, e.amountCents, e.categoryId, e.date, e.remark, e.createdAt] })
export const noteStatement = (n: Note): Statement => ({ statement: 'INSERT OR REPLACE INTO notes(id,title,body,todos,images,pinned,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)', values: [n.id, n.title, n.body, JSON.stringify(n.todos), JSON.stringify(n.images), Number(n.pinned), n.position, n.createdAt, n.updatedAt] })
export const appearanceStatement = (a: Appearance): Statement => ({ statement: "INSERT OR REPLACE INTO settings(key,value) VALUES('appearance',?)", values: [JSON.stringify(a)] })
export async function write(statements: Statement[]): Promise<void> {
  // 安卓插件要求每条语句显式携带 values，无占位参数时也需传空数组。
  if (native && statements.length) await CapacitorSQLite.executeSet({ database, set: statements.map(s => ({ ...s, values: s.values ?? [] })), transaction: true })
}
function fromRow(row: Record<string, unknown>): Entry {
  return { id: String(row.id), type: row.type as Entry['type'], amountCents: Number(row.amount_cents), categoryId: String(row.category_id), date: String(row.date), remark: String(row.remark), createdAt: Number(row.created_at) }
}
export async function initialize(): Promise<Snapshot> {
  if (!native) return emptySnapshot()
  if (!connectionCreated) { await CapacitorSQLite.createConnection({ database, version: 1, encrypted: false, mode: 'no-encryption', readonly: false }); connectionCreated = true }
  if (!opened) { await CapacitorSQLite.open({ database, readonly: false }); opened = true }
  await CapacitorSQLite.execute({ database, statements: 'PRAGMA foreign_keys=ON;', transaction: false })
  const version = (await CapacitorSQLite.query({ database, statement: 'PRAGMA user_version', values: [] })).values?.[0]?.user_version ?? 0
  if (Number(version) > 1) throw new Error('数据库来自较新版本，请升级应用后再打开')
  await CapacitorSQLite.execute({ database, statements: schema, transaction: true })
  const [categoryRows, entryRows, noteRows, settingRows] = await Promise.all([
    CapacitorSQLite.query({ database, statement: 'SELECT * FROM categories ORDER BY position', values: [] }),
    CapacitorSQLite.query({ database, statement: 'SELECT * FROM entries ORDER BY date DESC,created_at DESC', values: [] }),
    CapacitorSQLite.query({ database, statement: 'SELECT * FROM notes ORDER BY pinned DESC,position', values: [] }),
    CapacitorSQLite.query({ database, statement: "SELECT value FROM settings WHERE key='appearance'", values: [] }),
  ])
  const defaults = emptySnapshot()
  if (!categoryRows.values?.length) await write(defaults.categories.map(categoryStatement))
  return {
    categories: categoryRows.values?.length ? categoryRows.values.map((c: Record<string, unknown>) => ({ id: String(c.id), type: c.type as Category['type'], name: String(c.name), position: Number(c.position) })) : defaults.categories,
    entries: (entryRows.values ?? []).map(fromRow),
    notes: (noteRows.values ?? []).map((n: Record<string, unknown>) => ({ id: String(n.id), title: String(n.title), body: String(n.body), todos: JSON.parse(String(n.todos)), images: JSON.parse(String(n.images)), pinned: Number(n.pinned) === 1, position: Number(n.position), createdAt: Number(n.created_at), updatedAt: Number(n.updated_at) })),
    appearance: settingRows.values?.[0]?.value ? JSON.parse(settingRows.values[0].value) : defaults.appearance,
  }
}
export async function findEntries(filter: LedgerFilter, preview: Entry[]): Promise<Entry[]> {
  if (!native) return filterEntries(preview, filter)
  const clauses: string[] = [], values: (string | number)[] = []
  if (filter.from) { clauses.push('date>=?'); values.push(filter.from) }
  if (filter.to) { clauses.push('date<=?'); values.push(filter.to) }
  if (filter.type) { clauses.push('type=?'); values.push(filter.type) }
  if (filter.categoryId) { clauses.push('category_id=?'); values.push(filter.categoryId) }
  if (filter.min.trim()) { clauses.push('amount_cents>=?'); values.push(cents(filter.min, true)) }
  if (filter.max.trim()) { clauses.push('amount_cents<=?'); values.push(cents(filter.max, true)) }
  if (filter.keyword.trim()) { clauses.push('instr(lower(remark),lower(?))>0'); values.push(filter.keyword.trim()) }
  const result = await CapacitorSQLite.query({ database, statement: `SELECT * FROM entries${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY date DESC,created_at DESC`, values })
  return (result.values ?? []).map(fromRow)
}
export async function replaceAll(snapshot: Snapshot): Promise<void> {
  await write([
    { statement: 'DELETE FROM entries' }, { statement: 'DELETE FROM notes' }, { statement: 'DELETE FROM categories' }, { statement: 'DELETE FROM settings' },
    ...snapshot.categories.map(categoryStatement), ...snapshot.entries.map(entryStatement), ...snapshot.notes.map(noteStatement), appearanceStatement(snapshot.appearance),
  ])
}
