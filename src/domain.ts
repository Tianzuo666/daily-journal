export type EntryType = 'expense' | 'income'
export interface Category { id: string; type: EntryType; name: string; position: number }
export interface Entry {
  id: string; type: EntryType; amountCents: number; categoryId: string
  date: string; remark: string; createdAt: number
}
export interface Todo { id: string; text: string; done: boolean }
export interface Attachment {
  file: string; name: string; mime: string; size: number; sha256: string
}
export interface Note {
  id: string; title: string; body: string; todos: Todo[]; images: Attachment[]
  pinned: boolean; position: number; createdAt: number; updatedAt: number
}
export type ThemePreset = 'forest' | 'ocean' | 'plum' | 'sand' | 'custom'
export interface Appearance {
  preset: ThemePreset; mode: 'system' | 'light' | 'dark'; accent: string; background: string
}
export interface Snapshot { categories: Category[]; entries: Entry[]; notes: Note[]; appearance: Appearance }
export interface LedgerFilter {
  from: string; to: string; type: EntryType | ''; categoryId: string
  keyword: string; min: string; max: string
}
export const MAX_CENTS = 99_999_999_999
export const id = () => crypto.randomUUID()
export const defaultAppearance = (): Appearance => ({ preset: 'forest', mode: 'system', accent: '#28563d', background: '#f5f6f4' })
export const emptySnapshot = (): Snapshot => ({
  entries: [], notes: [], appearance: defaultAppearance(),
  categories: [
    ...['餐饮', '交通', '购物', '居家', '娱乐', '其他'].map((name, position) => ({ id: `expense-${position}`, type: 'expense' as const, name, position })),
    ...['工资', '奖金', '其他收入'].map((name, position) => ({ id: `income-${position}`, type: 'income' as const, name, position })),
  ],
})

export function cents(text: string, allowZero = false): number {
  const value = text.trim()
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(value)) throw new Error('请输入最多两位小数的金额，整数部分最多九位')
  const [whole, fraction = ''] = value.split('.')
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (result > MAX_CENTS || result < (allowZero ? 0 : 1)) throw new Error(allowZero ? '金额不能为负数' : '金额必须大于零')
  return result
}
export const amountText = (value: number) => `${Math.floor(Math.abs(value) / 100)}.${String(Math.abs(value) % 100).padStart(2, '0')}`
export const money = (value: number) => `${value < 0 ? '−' : ''}${(Math.abs(value) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 4) < '1900') return false
  const date = new Date(`${value}T12:00:00`)
  return Number.isFinite(date.getTime()) && localDate(date) === value
}
export function monthFilter(): LedgerFilter {
  const now = new Date()
  return { from: localDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: localDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)), type: '', categoryId: '', keyword: '', min: '', max: '' }
}
export function validateFilter(filter: LedgerFilter): void {
  if ((filter.from && !validDate(filter.from)) || (filter.to && !validDate(filter.to))) throw new Error('请选择有效日期')
  if (filter.from && filter.to && filter.from > filter.to) throw new Error('结束日期不能早于开始日期')
  const min = filter.min.trim() ? cents(filter.min, true) : undefined
  const max = filter.max.trim() ? cents(filter.max, true) : undefined
  if (min !== undefined && max !== undefined && min > max) throw new Error('最高金额不能小于最低金额')
}
export function filterEntries(entries: Entry[], filter: LedgerFilter): Entry[] {
  validateFilter(filter)
  const min = filter.min.trim() ? cents(filter.min, true) : 0
  const max = filter.max.trim() ? cents(filter.max, true) : MAX_CENTS
  return entries.filter(entry => (!filter.from || entry.date >= filter.from) && (!filter.to || entry.date <= filter.to)
    && (!filter.type || entry.type === filter.type) && (!filter.categoryId || entry.categoryId === filter.categoryId)
    && entry.amountCents >= min && entry.amountCents <= max && entry.remark.toLocaleLowerCase().includes(filter.keyword.trim().toLocaleLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
}
export function orderedNotes(notes: Note[], pinned: boolean, keyword = ''): Note[] {
  const q = keyword.trim().toLocaleLowerCase()
  return notes.filter(note => note.pinned === pinned && (!q || `${note.title}\n${note.body}\n${note.todos.map(t => t.text).join('\n')}`.toLocaleLowerCase().includes(q)))
    .sort((a, b) => a.position - b.position || b.createdAt - a.createdAt)
}
