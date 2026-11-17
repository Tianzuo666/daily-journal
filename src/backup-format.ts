import { MAX_CENTS, validDate, type Snapshot, type Appearance } from './domain'

export const BACKUP_FORMAT = 'daily-journal'
export const BACKUP_VERSION = 1
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
  requireValue(manifest.version === BACKUP_VERSION, '版本不支持，请使用兼容版本的应用')
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
  const todoIds = new Set<string>()
  for (const note of notes) {
    requireValue(text(note.title, 200) && text(note.body, 1_000_000) && typeof note.pinned === 'boolean'
      && integer(note.position) && integer(note.createdAt, 1) && integer(note.updatedAt, 1), '记录字段错误')
    requireValue(Array.isArray(note.todos) && Array.isArray(note.images), '记录附件结构错误')
    for (const todo of note.todos) {
      requireValue(object(todo) && identifier(todo.id) && text(todo.text, 1000) && typeof todo.done === 'boolean', '待办字段错误')
      requireValue(!todoIds.has(todo.id), '待办编号重复'); todoIds.add(todo.id)
    }
    for (const image of note.images) {
      requireValue(object(image) && typeof image.file === 'string' && imageFilePattern.test(image.file)
        && text(image.name, 300) && ['image/jpeg', 'image/png', 'image/webp'].includes(String(image.mime))
        && integer(image.size, 1, 100 * 1024 * 1024) && /^[0-9a-f]{64}$/.test(String(image.sha256)), '图片字段错误')
      requireValue(!files.has(image.file), '图片文件重复'); files.add(image.file)
    }
  }
  validateAppearance(data.appearance)
  return manifest as unknown as Manifest
}
export function makeManifest(data: Snapshot): string {
  const result = JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: Date.now(), data })
  parseManifest(result)
  return result
}
