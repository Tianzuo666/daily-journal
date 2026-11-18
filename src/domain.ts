export type EntryType = 'expense' | 'income'
export interface Category { id: string; type: EntryType; name: string; position: number }
export interface Entry {
  id: string; type: EntryType; amountCents: number; categoryId: string
  date: string; remark: string; createdAt: number
  images?: Attachment[]; deletedAt?: number
}
export interface Todo { id: string; text: string; done: boolean }
export interface Attachment {
  file: string; name: string; mime: string; size: number; sha256: string
}
export interface Note {
  id: string; title: string; body: string; todos: Todo[]; images: Attachment[]
  pinned: boolean; position: number; createdAt: number; updatedAt: number
  recordDate?: string; tagIds?: string[]; deletedAt?: number
}
export type ThemePreset = 'forest' | 'ocean' | 'plum' | 'sand' | 'custom'
export interface Appearance {
  preset: ThemePreset; mode: 'system' | 'light' | 'dark'; accent: string; background: string
}
export interface Tag { id: string; name: string }
// 仅保留旧二期备份的往返兼容，不再提供预算录入或计算功能。
export interface Budget { month: string; amountCents: number }
export interface RecurringRule { id: string; name: string; type: EntryType; amountCents: number; categoryId: string; remark: string; frequency: 'month' | 'year'; firstDate: string; endDate: string; enabled: boolean; resumeFrom: string; deleted?: boolean }
export interface Occurrence { id: string; ruleId: string; dueDate: string; name: string; type: EntryType; amountCents: number; categoryId: string; remark: string; state: 'pending' | 'skipped' | 'confirmed'; entryId?: string }
export interface Snapshot { categories: Category[]; entries: Entry[]; notes: Note[]; appearance: Appearance; tags: Tag[]; budgets: Budget[]; rules: RecurringRule[]; occurrences: Occurrence[]; recent: { income: string[]; expense: string[] } }
export interface LedgerFilter {
  from: string; to: string; type: EntryType | ''; categoryIds: string[]
  keyword: string; min: string; max: string
}
export const MAX_CENTS = 99_999_999_999
export const id = () => crypto.randomUUID()
export const defaultAppearance = (): Appearance => ({ preset: 'forest', mode: 'system', accent: '#28563d', background: '#f5f6f4' })
export const emptySnapshot = (): Snapshot => ({
  entries: [], notes: [], appearance: defaultAppearance(), tags: [], budgets: [], rules: [], occurrences: [], recent: { income: [], expense: [] },
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
  return { from: localDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: localDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)), type: 'expense', categoryIds: [], keyword: '', min: '', max: '' }
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
  const categories = new Set(filter.categoryIds)
  return entries.filter(entry => !entry.deletedAt && (!filter.from || entry.date >= filter.from) && (!filter.to || entry.date <= filter.to)
    && (!filter.type || entry.type === filter.type) && (!categories.size || categories.has(entry.categoryId))
    && entry.amountCents >= min && entry.amountCents <= max && entry.remark.toLocaleLowerCase().includes(filter.keyword.trim().toLocaleLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
}
export interface EntryDayGroup { date: string; entries: Entry[]; expense: number; income: number }
// 按账单日期归组，收支分别累计整数分；调用方先筛选，避免日小计混入隐藏账单。
export function groupEntriesByDay(entries: Entry[]): EntryDayGroup[] {
  const groups = new Map<string, EntryDayGroup>()
  const ordered = entries.filter(entry => !entry.deletedAt).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
  for (const entry of ordered) {
    let group = groups.get(entry.date)
    if (!group) { group = { date: entry.date, entries: [], expense: 0, income: 0 }; groups.set(entry.date, group) }
    group.entries.push(entry); group[entry.type] += entry.amountCents
  }
  return [...groups.values()]
}
export function orderedNotes(notes: Note[], pinned: boolean, keyword = ''): Note[] {
  const q = keyword.trim().toLocaleLowerCase()
  return notes.filter(note => !note.deletedAt && note.pinned === pinned && (!q || `${note.title}\n${note.body}\n${note.todos.map(t => t.text).join('\n')}`.toLocaleLowerCase().includes(q)))
    .sort((a, b) => a.position - b.position || b.createdAt - a.createdAt)
}

export const noteDate = (note: Note) => note.recordDate ?? localDate(new Date(note.createdAt))
export const allImages = (data: Snapshot) => [...data.entries, ...data.notes].flatMap(item => item.images ?? [])
export function monthBounds(month: string): { from: string; to: string } {
  const [year, value] = month.split('-').map(Number)
  return { from: `${month}-01`, to: localDate(new Date(year, value, 0)) }
}
// 每次从原定月日计算，月末截断不能改变下一期的日期锚点。
export function recurringDates(rule: RecurringRule, today: string): string[] {
  const [year, month, day] = rule.firstDate.split('-').map(Number), result: string[] = []
  const end = rule.endDate && rule.endDate < today ? rule.endDate : today
  const start = Math.max(0, rule.frequency === 'month' ? (Number(rule.resumeFrom.slice(0, 4)) - year) * 12 + Number(rule.resumeFrom.slice(5, 7)) - month : Number(rule.resumeFrom.slice(0, 4)) - year)
  for (let offset = start; ; offset++) {
    const base = new Date(year + (rule.frequency === 'year' ? offset : 0), month - 1 + (rule.frequency === 'month' ? offset : 0), 1)
    if (localDate(base) > end) break
    const last = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate()
    const date = localDate(new Date(base.getFullYear(), base.getMonth(), Math.min(day, last)))
    if (date >= rule.firstDate && date >= rule.resumeFrom && date <= end) result.push(date)
  }
  return result
}
export function generateOccurrences(data: Snapshot, today = localDate()): Occurrence[] {
  const existing = new Set(data.occurrences.map(o => `${o.ruleId}:${o.dueDate}`)), additions: Occurrence[] = []
  for (const rule of data.rules.filter(r => r.enabled && !r.deleted)) for (const dueDate of recurringDates(rule, today)) {
    const key = `${rule.id}:${dueDate}`
    if (!existing.has(key)) { additions.push({ id: id(), ruleId: rule.id, dueDate, name: rule.name, type: rule.type, amountCents: rule.amountCents, categoryId: rule.categoryId, remark: rule.remark, state: 'pending' }); existing.add(key) }
  }
  return additions
}
