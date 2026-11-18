import { MAX_CENTS, validDate, emptySnapshot, localDate, type Snapshot, type Appearance, type Occurrence, type RecurringRule, type Entry, type Note } from './domain'

export const BACKUP_FORMAT = 'daily-journal'
export const BACKUP_VERSION = 2
export const imageFilePattern = /^[0-9a-f-]{36}\.(jpg|png|webp)$/
export interface Manifest { format: typeof BACKUP_FORMAT; version: number; createdAt: number; data: Snapshot }

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`备份无效：${message}`)
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,100}$/.test(value)
function uniqueIds(items: Record<string, unknown>[], name: string) {
  requireValue(items.every(item => identifier(item.id)), `${name}编号错误`)
  requireValue(new Set(items.map(item => item.id)).size === items.length, `${name}编号重复`)
}
export function validateAppearance(value: unknown): asserts value is Appearance {
  requireValue(object(value) && ['forest', 'ocean', 'plum', 'sand', 'custom'].includes(String(value.preset))
    && ['system', 'light', 'dark'].includes(String(value.mode))
    && /^#[0-9a-f]{6}$/i.test(String(value.accent)) && /^#[0-9a-f]{6}$/i.test(String(value.background)), '外观设置错误')
}
export function parseManifest(raw: string): Manifest {
  let manifest: unknown
  try { manifest = JSON.parse(raw) } catch { throw new Error('备份清单不是有效 JSON') }
  requireValue(object(manifest) && manifest.format === BACKUP_FORMAT, '不是本应用的备份')
  requireValue(manifest.version === 1 || manifest.version === BACKUP_VERSION, '版本不支持，请使用兼容版本的应用')
  requireValue(integer(manifest.createdAt, 1), '备份时间错误')
  const data = manifest.data
  requireValue(object(data), '缺少数据')
  for (const key of ['categories', 'entries', 'notes']) requireValue(Array.isArray(data[key]) && data[key].every(object), `${key}结构错误`)
  const categories = data.categories as Record<string, unknown>[]
  const entries = data.entries as Record<string, unknown>[]
  const notes = data.notes as Record<string, unknown>[]
  uniqueIds(categories, '分类'); uniqueIds(entries, '账单'); uniqueIds(notes, '记录')
  requireValue(categories.length > 0, '缺少分类')
  for (const category of categories) {
    requireValue(['expense', 'income'].includes(String(category.type)) && text(category.name, 30) && category.name.trim().length > 0 && integer(category.position), '分类字段错误')
  }
  requireValue(new Set(categories.map(c => `${c.type}:${String(c.name).trim()}`)).size === categories.length, '分类名称重复')
  const categoryMap = new Map(categories.map(category => [category.id, category]))
  for (const entry of entries) {
    requireValue(['expense', 'income'].includes(String(entry.type)) && categoryMap.get(entry.categoryId)?.type === entry.type, '账单分类不存在或类型不符')
    requireValue(integer(entry.amountCents, 1, MAX_CENTS) && text(entry.date, 10) && validDate(entry.date)
      && text(entry.remark, 500) && integer(entry.createdAt, 1), '账单字段错误')
  }
  const files = new Set<string>()
  function attachments(images: unknown) {
    requireValue(Array.isArray(images), '图片结构错误')
    for (const image of images) {
      requireValue(object(image) && typeof image.file === 'string' && imageFilePattern.test(image.file) && text(image.name, 300)
        && ['image/jpeg', 'image/png', 'image/webp'].includes(String(image.mime)) && integer(image.size, 1, 100 * 1024 * 1024) && /^[0-9a-f]{64}$/.test(String(image.sha256)), '图片字段错误')
      requireValue(!files.has(image.file), '图片文件重复'); files.add(image.file)
    }
  }
  for (const entry of entries) { requireValue(integer(entry.deletedAt ?? 0), '账单删除时间无效'); attachments(entry.images ?? []); requireValue((entry.images as unknown[] | undefined)?.length === undefined || (entry.images as unknown[]).length <= 9, '账单图片超过9张') }
  const todoIds = new Set<string>()
  for (const note of notes) {
    requireValue(text(note.title, 200) && text(note.body, 1_000_000) && typeof note.pinned === 'boolean'
      && integer(note.position) && integer(note.createdAt, 1) && integer(note.updatedAt, 1), '记录字段错误')
    requireValue(Array.isArray(note.todos) && Array.isArray(note.images), '记录附件结构错误')
    for (const todo of note.todos) {
      requireValue(object(todo) && identifier(todo.id) && text(todo.text, 1000) && typeof todo.done === 'boolean', '待办字段错误')
      requireValue(!todoIds.has(todo.id), '待办编号重复'); todoIds.add(todo.id)
    }
    attachments(note.images)
    const recordDate = String(note.recordDate ?? localDate(new Date(Number(note.createdAt))))
    requireValue(integer(note.deletedAt ?? 0) && validDate(recordDate), '记录日期或删除时间错误')
  }
  validateAppearance(data.appearance)
  const defaults = emptySnapshot()
  const normalized: Snapshot = { ...defaults, categories: categories as unknown as Snapshot['categories'], entries: entries as unknown as Entry[], notes: notes as unknown as Note[], appearance: data.appearance as Appearance }
  // 一期备份只补充二期默认值，不从旧格式推断周期或预算。
  if (manifest.version === 1) {
    normalized.notes = normalized.notes.map(n => ({ ...n, recordDate: localDate(new Date(n.createdAt)), tagIds: [], deletedAt: 0 }))
    normalized.entries = normalized.entries.map(e => ({ ...e, images: [], deletedAt: 0 }))
  }
  else {
    for (const key of ['tags', 'budgets', 'rules', 'occurrences']) requireValue(Array.isArray(data[key]) && data[key].every(object), `${key}结构错误`)
    normalized.tags = data.tags as Snapshot['tags']; normalized.budgets = data.budgets as Snapshot['budgets']; normalized.rules = data.rules as RecurringRule[]; normalized.occurrences = data.occurrences as Occurrence[]
    uniqueIds(data.tags as Record<string, unknown>[], '标签'); uniqueIds(data.rules as Record<string, unknown>[], '周期规则'); uniqueIds(data.occurrences as Record<string, unknown>[], '周期项')
    const names = new Set<string>(), tags = new Set(normalized.tags.map(t => t.id))
    for (const tag of normalized.tags) { requireValue(text(tag.name, 20) && !!tag.name.trim() && tag.name === tag.name.trim() && !names.has(tag.name), '标签名称无效或重复'); names.add(tag.name) }
    for (const note of notes) {
      const ids = note.tagIds ?? []
      requireValue(Array.isArray(ids) && new Set(ids).size === ids.length && ids.every(t => typeof t === 'string' && tags.has(t)), '记录标签引用错误')
    }
    const months = new Set<string>()
    for (const budget of normalized.budgets) { requireValue(/^\d{4}-\d{2}$/.test(budget.month) && validDate(budget.month + '-01') && integer(budget.amountCents, 1, MAX_CENTS) && !months.has(budget.month), '月预算错误或重复'); months.add(budget.month) }
    for (const rule of normalized.rules) requireValue(text(rule.name, 100) && !!rule.name.trim() && ['income', 'expense'].includes(rule.type) && categoryMap.get(rule.categoryId)?.type === rule.type && integer(rule.amountCents, 1, MAX_CENTS)
      && text(rule.remark, 500) && ['month', 'year'].includes(rule.frequency) && validDate(rule.firstDate) && validDate(rule.resumeFrom) && (rule.endDate === '' || (validDate(rule.endDate) && rule.endDate >= rule.firstDate)) && typeof rule.enabled === 'boolean' && (rule.deleted === undefined || typeof rule.deleted === 'boolean'), '周期规则错误')
    const periods = new Set<string>(), rules = new Set(normalized.rules.map(r => r.id)), linkedEntries = new Set<string>()
    for (const occurrence of normalized.occurrences) {
      const key = occurrence.ruleId + ':' + occurrence.dueDate
      requireValue(rules.has(occurrence.ruleId) && validDate(occurrence.dueDate) && !periods.has(key) && text(occurrence.name, 100) && ['income', 'expense'].includes(occurrence.type)
        && categoryMap.get(occurrence.categoryId)?.type === occurrence.type && integer(occurrence.amountCents, 1, MAX_CENTS) && text(occurrence.remark, 500) && ['pending', 'skipped', 'confirmed'].includes(occurrence.state), '周期项错误或重复')
      if (occurrence.state === 'confirmed') { requireValue(identifier(occurrence.entryId) && !linkedEntries.has(occurrence.entryId), '周期入账关联错误'); linkedEntries.add(occurrence.entryId) }
      else requireValue(occurrence.entryId === undefined, '未确认期次不能关联账单')
      periods.add(key)
    }
    requireValue(object(data.recent) && Array.isArray(data.recent.income) && Array.isArray(data.recent.expense), '最近分类错误')
    normalized.recent = data.recent as Snapshot['recent']
    for (const type of ['income', 'expense'] as const) requireValue(normalized.recent[type].length <= 5 && new Set(normalized.recent[type]).size === normalized.recent[type].length && normalized.recent[type].every(c => categoryMap.get(c)?.type === type), '最近分类引用错误')
  }
  return { format: BACKUP_FORMAT, version: Number(manifest.version), createdAt: Number(manifest.createdAt), data: normalized }
}
export function makeManifest(data: Snapshot): string {
  const result = JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: Date.now(), data })
  parseManifest(result)
  return result
}
