import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { emptySnapshot, id, localDate, validDate, MAX_CENTS, allImages, generateOccurrences, type Snapshot, type RecurringRule, type Entry, type Note, type Category, type Appearance } from '../domain'
import { initialize, write, replaceAll, readDevice, saveDevice, metaStatement, categoryStatement, entryStatement, noteStatement, appearanceStatement, type Statement } from '../data/database'
import { makeManifest, parseManifest, validateAppearance } from '../backup-format'
import { files, native, type BackupFile, type StagedBackup } from '../native'

export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

export const useJournal = defineStore('journal', () => {
  const data = ref(emptySnapshot())
  const ready = ref(false), bootError = ref(''), processing = ref(''), message = ref('')
  const imageDirectory = ref(''), backups = ref<BackupFile[]>([])
  const saving = ref(0)
  const device = ref<Record<string, number | boolean | string>>({}), today = ref(localDate())
  const pending = computed(() => data.value.occurrences.filter(o => o.state === 'pending').sort((a, b) => a.dueDate.localeCompare(b.dueDate)))
  const backupDue = computed(() => device.value.reminders !== false && [...data.value.entries, ...data.value.notes].some(item => !item.deletedAt)
    && Number(device.value.changedAt ?? 0) > Number(device.value.exportedDataAt ?? device.value.exportedAt ?? 0) && Date.now() - Number(device.value.exportedAt ?? 0) >= 7 * 86_400_000 && device.value.dismissedDay !== today.value)
  const busy = computed(() => !!processing.value)
  let tail: Promise<unknown> = Promise.resolve()
  let deviceTail: Promise<unknown> = Promise.resolve()
  let timer: ReturnType<typeof setTimeout> | undefined
  function notify(text: string) { message.value = text; clearTimeout(timer); timer = setTimeout(() => { message.value = '' }, 4000) }
  function exclusive<T>(job: () => Promise<T>): Promise<T> {
    const result = tail.then(job)
    tail = result.then(() => undefined, () => undefined)
    return result
  }
  async function run<T>(label: string, job: () => Promise<T>): Promise<T> {
    if (busy.value) throw new Error('当前操作尚未完成，请稍候')
    processing.value = label
    try { return await exclusive(job) } finally { processing.value = '' }
  }
  async function refreshFiles() {
    if (!native) return
    const info = await files.info()
    imageDirectory.value = info.imageDirectory
    backups.value = info.backups
  }
  async function boot() {
    if (ready.value) return
    bootError.value = ''
    try { const loaded = await initialize(); parseManifest(makeManifest(loaded)); data.value = loaded; device.value = await readDevice(); if (!device.value.changedAt && (loaded.entries.length || loaded.notes.length)) await changed(); await refreshFiles(); await maintenance(); ready.value = true } catch (error) { bootError.value = errorMessage(error) }
  }
  // 提醒、内容修改和另存可能同时更新设备设置，串行合并以免覆盖其他字段。
  function updateDevice(change: Record<string, number | boolean | string>) {
    const result = deviceTail.then(async () => { const next = { ...device.value, ...change }; await saveDevice(next); device.value = next })
    deviceTail = result.catch(() => undefined)
    return result
  }
  async function changed() { try { await updateDevice({ changedAt: Date.now() }) } catch { notify('内容已保存，但备份提醒时间未能更新') } }
  async function saveEntry(input: Entry, occurrenceId?: string) {
    const entry = clone(input)
    await exclusive(async () => {
      const category = data.value.categories.find(c => c.id === entry.categoryId)
      if (!category || category.type !== entry.type) throw new Error('请选择与收支类型匹配的分类')
      if (!Number.isSafeInteger(entry.amountCents) || entry.amountCents < 1 || entry.amountCents > MAX_CENTS || !validDate(entry.date)) throw new Error('金额或日期无效')
      if (data.value.entries.find(e => e.id === entry.id)?.deletedAt) throw new Error('账单已在回收站，请先恢复')
      const next = clone(data.value), occurrence = next.occurrences.find(o => o.id === occurrenceId)
      if (occurrenceId && (!occurrence || occurrence.state !== 'pending')) throw new Error('这期账单已经处理，请刷新')
      if (occurrence) { occurrence.state = 'confirmed'; occurrence.entryId = entry.id }
      next.entries = [...next.entries.filter(e => e.id !== entry.id), entry]
      next.recent[entry.type] = [entry.categoryId, ...next.recent[entry.type].filter(c => c !== entry.categoryId)].slice(0, 5)
      parseManifest(makeManifest(next))
      const previousImages = allImages(data.value).map(i => i.file)
      await write([entryStatement(entry), metaStatement(next)]); data.value = next
      await changed(); await removeUnusedImages(previousImages)
    })
  }
  async function deleteEntry(entryId: string) {
    await exclusive(async () => {
      const entry = data.value.entries.find(e => e.id === entryId)
      if (!entry || entry.deletedAt) return
      const removed = { ...entry, deletedAt: Date.now() }
      await write([entryStatement(removed)]); data.value = { ...data.value, entries: data.value.entries.map(e => e.id === entryId ? removed : e) }; await changed()
    })
  }
  async function removeUnusedImages(names: string[]) {
    if (!native || !names.length) return
    const used = new Set(allImages(data.value).map(i => i.file))
    try { await files.removeImages({ images: names.filter(name => !used.has(name)) }) } catch { /* 数据已落盘；清理失败只保留多余文件，不影响记录。 */ }
  }
  async function saveNote(input: Note) {
    const note = clone(input)
    if (!note.title.trim() && !note.body.trim() && !note.todos.some(t => t.text.trim()) && !note.images.length && !data.value.notes.some(n => n.id === note.id)) return
    saving.value++
    try {
      await exclusive(async () => {
        const previous = data.value.notes.find(n => n.id === note.id)
        if (previous?.deletedAt) throw new Error('记录已在回收站，请先恢复')
        const notes = clone(data.value.notes.filter(n => n.id !== note.id))
        const statements: Statement[] = []
        if (!previous) {
          note.position = 0
          notes.filter(other => !other.deletedAt && !other.pinned).sort((a, b) => a.position - b.position || b.createdAt - a.createdAt).forEach((other, index) => {
            other.position = index + 1; statements.push({ statement: 'UPDATE notes SET position=? WHERE id=?', values: [other.position, other.id] })
          })
        } else { note.pinned = previous.pinned; note.position = previous.position }
        note.updatedAt = Date.now()
        statements.push(noteStatement(note))
        parseManifest(makeManifest({ ...data.value, notes: [...notes, note] }))
        await write(statements)
        data.value = { ...data.value, notes: [...notes, note] }
        await changed()
        await removeUnusedImages((previous?.images ?? []).filter(i => !note.images.some(n => n.file === i.file)).map(i => i.file))
      })
    } finally { saving.value-- }
  }
  async function deleteNote(noteId: string) {
    await exclusive(async () => {
      const previous = data.value.notes.find(n => n.id === noteId)
      if (!previous || previous.deletedAt) return
      const removed = { ...previous, deletedAt: Date.now() }
      await write([noteStatement(removed)]); data.value = { ...data.value, notes: data.value.notes.map(n => n.id === noteId ? removed : n) }; await changed()
    })
  }
  async function togglePin(noteId: string) {
    await exclusive(async () => {
      const notes = clone(data.value.notes), note = notes.find(n => n.id === noteId)
      if (!note || note.deletedAt) return
      note.pinned = !note.pinned
      notes.filter(other => !other.deletedAt && other.id !== note.id && other.pinned === note.pinned).sort((a, b) => a.position - b.position || b.createdAt - a.createdAt).forEach((other, index) => { other.position = index + 1 })
      note.position = 0
      await write(notes.filter(n => !n.deletedAt && n.pinned === note.pinned).map(noteStatement))
      data.value = { ...data.value, notes }; await changed()
    })
  }
  async function reorder(pinned: boolean, order: string[]) {
    await exclusive(async () => {
      const notes = clone(data.value.notes), group = notes.filter(n => !n.deletedAt && n.pinned === pinned)
      if (order.length !== group.length || new Set(order).size !== group.length || !group.every(n => order.includes(n.id))) throw new Error('记录列表已变化，请重新排序')
      group.forEach(n => { n.position = order.indexOf(n.id) })
      await write(group.map(noteStatement)); data.value = { ...data.value, notes }; await changed()
    })
  }
  async function saveAppearance(input: Appearance) {
    const appearance = clone(input); validateAppearance(appearance)
    await exclusive(async () => { await write([appearanceStatement(appearance)]); data.value = { ...data.value, appearance }; await changed() })
  }
  async function saveCategory(input: Category) {
    const category = clone(input); category.name = category.name.trim()
    await exclusive(async () => {
      if (!category.name || category.name.length > 30) throw new Error('分类名称需为 1～30 个字')
      if (data.value.categories.some(c => c.id !== category.id && c.type === category.type && c.name === category.name)) throw new Error('同类型中已有这个分类')
      const previous = data.value.categories.find(c => c.id === category.id)
      if (previous && previous.type !== category.type) throw new Error('已有分类不能更换收支类型')
      await write([categoryStatement(category)])
      data.value = { ...data.value, categories: [...data.value.categories.filter(c => c.id !== category.id), category] }
      await changed()
    })
  }
  async function deleteCategory(categoryId: string) {
    await exclusive(async () => {
      if (data.value.categories.length <= 1) throw new Error('至少需要保留一个记账分类')
      if (categoryUse(categoryId).total) throw new Error('分类仍被账单或周期规则引用，请使用合并')
      const next = clone(data.value); next.categories = next.categories.filter(c => c.id !== categoryId)
      next.recent.income = next.recent.income.filter(c => c !== categoryId); next.recent.expense = next.recent.expense.filter(c => c !== categoryId)
      await write([{ statement: 'DELETE FROM categories WHERE id=?', values: [categoryId] }, metaStatement(next)]); data.value = next; await changed()
    })
  }
  async function createBackupInside(): Promise<BackupFile> {
    if (!native) throw new Error('备份需要在安卓版本中使用')
    const backup = await files.createBackup({ manifest: makeManifest(data.value) })
    try { await updateDevice({ backupAt: backup.createdAt }) } catch { notify('完整备份已生成，但备份时间未能更新') }
    await refreshFiles()
    return backup
  }
  const backup = () => run('正在完整备份…', createBackupInside)
  const chooseBackup = () => run('正在读取和检查备份…', async () => {
    if (!native) throw new Error('导入需要在安卓版本中使用')
    const stage = await files.chooseBackup()
    if (stage.cancelled) return null
    try { return { stage, manifest: parseManifest(stage.manifest) } }
    catch (error) { await files.discardStage({ token: stage.token }); throw error }
  })
  async function restore(stage: StagedBackup) {
    return run('正在备份当前数据并恢复…', async () => {
      const manifest = parseManifest(stage.manifest)
      // 先留下独立的完整备份，再复制不可变图片；数据库事务失败时原引用仍然有效。
      const recovery = await createBackupInside()
      await files.installImages({ token: stage.token })
      await replaceAll(manifest.data)
      const previousImages = allImages(data.value).map(image => image.file)
      data.value = manifest.data
      await changed()
      await removeUnusedImages(previousImages)
      await refreshFiles()
      notify(`恢复完成，覆盖前备份：${recovery.name}`)
      try { await files.discardStage({ token: stage.token }) } catch { /* 失败只留下临时文件，原生层下次启动时清理。 */ }
    })
  }
  async function exportBackup(backupFile: BackupFile) {
    await run('请选择备份保存位置…', async () => {
      const result = await files.exportFile({ path: backupFile.path, name: backupFile.name, mime: 'application/zip' })
      // 另存旧文件不能把之后的编辑标记为已备份；操作时间和快照时间分别保存。
      if (!result.cancelled) { try { await updateDevice({ exportedAt: Date.now(), exportedDataAt: backupFile.createdAt }) } catch { notify('备份已另存，但提醒时间未能更新'); return }; notify('已另存完整备份到应用外；该文件未加密') }
    })
  }
  async function exportLedger() {
    await run('正在导出账单…', async () => {
      if (!native) throw new Error('导出需要在安卓版本中使用')
      const cell = (value: string) => `"${(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`
      const rows = [['日期', '类型', '金额（元）', '分类', '备注'], ...data.value.entries.filter(e => !e.deletedAt).sort((a, b) => b.date.localeCompare(a.date)).map(e => [e.date, e.type === 'income' ? '收入' : '支出', (e.amountCents / 100).toFixed(2), data.value.categories.find(c => c.id === e.categoryId)?.name ?? '', e.remark])]
      const name = `日常记-账单-${localDate()}.csv`
      const file = await files.createTextExport({ name, content: '\ufeff' + rows.map(row => row.map(cell).join(',')).join('\r\n') })
      await files.exportFile({ path: file.path, name, mime: 'text/csv' })
    })
  }
  async function exportNotes() {
    await run('正在导出记录和图片…', async () => {
      if (!native) throw new Error('导出需要在安卓版本中使用')
      const file = await files.createNotesExport({ notes: JSON.stringify(data.value.notes.filter(n => !n.deletedAt).map(n => ({ ...n, tagNames: (n.tagIds ?? []).map(t => data.value.tags.find(tag => tag.id === t)?.name ?? '') }))) })
      await files.exportFile({ path: file.path, name: `日常记-记录-${localDate()}.zip`, mime: 'application/zip' })
    })
  }
  // 较少发生的跨实体操作使用完整事务，内存只在提交成功后替换。
  async function commit(next: Snapshot) {
    parseManifest(makeManifest(next)); const images = allImages(data.value).map(i => i.file)
    await replaceAll(next); data.value = next; await changed(); await removeUnusedImages(images)
  }
  async function mutate(job: (next: Snapshot) => void) { await exclusive(async () => { const next = clone(data.value); job(next); await commit(next) }) }
  async function maintenance() {
    today.value = localDate()
    await exclusive(async () => {
      const next = clone(data.value), expired = Date.now() - 30 * 86_400_000
      next.entries = next.entries.filter(e => !e.deletedAt || e.deletedAt > expired)
      next.notes = next.notes.filter(n => !n.deletedAt || n.deletedAt > expired)
      const additions = generateOccurrences(next, today.value); next.occurrences.push(...additions)
      if (additions.length || next.entries.length !== data.value.entries.length || next.notes.length !== data.value.notes.length) await commit(next)
    })
  }
  async function restoreItem(kind: 'entry' | 'note', itemId: string) {
    await mutate(next => {
      if (kind === 'entry') { const item = next.entries.find(e => e.id === itemId); if (item) item.deletedAt = 0 }
      else { const item = next.notes.find(n => n.id === itemId); if (item) { if (next.notes.some(n => !n.deletedAt && n.pinned === item.pinned && n.position === item.position)) item.position = Math.max(-1, ...next.notes.filter(n => !n.deletedAt && n.pinned === item.pinned).map(n => n.position)) + 1; item.deletedAt = 0 } }
    })
  }
  async function purge(kind?: 'entry' | 'note', itemId?: string) {
    await mutate(next => { next.entries = next.entries.filter(e => !(e.deletedAt && (!kind || kind === 'entry') && (!itemId || e.id === itemId))); next.notes = next.notes.filter(n => !(n.deletedAt && (!kind || kind === 'note') && (!itemId || n.id === itemId))) })
  }
  function categoryUse(categoryId: string) {
    const active = data.value.entries.filter(e => e.categoryId === categoryId && !e.deletedAt).length, trash = data.value.entries.filter(e => e.categoryId === categoryId && e.deletedAt).length
    const rules = data.value.rules.filter(r => r.categoryId === categoryId).length, periods = data.value.occurrences.filter(o => o.categoryId === categoryId).length
    return { active, trash, rules, periods, total: active + trash + rules + periods }
  }
  async function mergeCategory(sourceId: string, targetId: string) {
    await run('正在备份并合并分类…', async () => {
      const next = clone(data.value), source = next.categories.find(c => c.id === sourceId), target = next.categories.find(c => c.id === targetId)
      if (!source || !target || source.id === target.id || source.type !== target.type) throw new Error('只能合并不同的同类型分类')
      const recovery = await createBackupInside()
      for (const item of [...next.entries, ...next.rules, ...next.occurrences]) if (item.categoryId === sourceId) item.categoryId = targetId
      for (const type of ['income', 'expense'] as const) next.recent[type] = [...new Set(next.recent[type].map(c => c === sourceId ? targetId : c))]
      next.categories = next.categories.filter(c => c.id !== sourceId); await commit(next)
      window.dispatchEvent(new CustomEvent('journal-category-merged', { detail: { sourceId, targetId } })); notify(`已合并；保护备份：${recovery.name}`)
    })
  }
  async function reorderCategories(type: Category['type'], ids: string[]) {
    await mutate(next => { const group = next.categories.filter(c => c.type === type); if (group.length !== ids.length || new Set(ids).size !== ids.length || !group.every(c => ids.includes(c.id))) throw new Error('分类列表已变化'); group.forEach(c => { c.position = ids.indexOf(c.id) }) })
  }
  async function saveTag(name: string, tagId: string = id()): Promise<string> {
    name = name.trim()
    if (!name || name.length > 20) throw new Error('标签需为1～20字')
    const existing = data.value.tags.find(t => t.name === name && t.id !== tagId)
    if (existing) { if (data.value.tags.some(t => t.id === tagId)) throw new Error('已有同名标签'); return existing.id }
    await mutate(next => { next.tags = [...next.tags.filter(t => t.id !== tagId), { id: tagId, name }] }); return tagId
  }
  async function deleteTag(tagId: string) { await mutate(next => { next.tags = next.tags.filter(t => t.id !== tagId); next.notes.forEach(n => { n.tagIds = (n.tagIds ?? []).filter(t => t !== tagId) }) }) }
  async function saveRule(input: RecurringRule) {
    await maintenance()
    await mutate(next => {
      const previous = next.rules.find(r => r.id === input.id), rule = clone(input)
      if ((!previous || previous.firstDate !== rule.firstDate) && rule.firstDate < today.value) throw new Error('首次日期不能早于今天')
      if (previous && (previous.firstDate !== rule.firstDate || previous.frequency !== rule.frequency) && next.occurrences.some(o => o.ruleId === rule.id && o.dueDate > today.value)) throw new Error('后续日期与已有期次冲突')
      // 先补齐旧规则已到期期次，再从当天应用新规则，避免改周期时倒补历史。
      if (previous && rule.enabled) rule.resumeFrom = today.value
      if (!previous) rule.resumeFrom = rule.firstDate
      next.rules = [...next.rules.filter(r => r.id !== rule.id), rule]
    }); await maintenance()
  }
  async function deleteRule(ruleId: string) { await maintenance(); await mutate(next => { const rule = next.rules.find(r => r.id === ruleId); if (rule) { rule.deleted = true; rule.enabled = false } }) }
  async function skipOccurrence(occurrenceId: string) { await mutate(next => { const item = next.occurrences.find(o => o.id === occurrenceId); if (item && item.state !== 'confirmed') item.state = item.state === 'pending' ? 'skipped' : 'pending' }) }
  async function deleteBackup(file: BackupFile) { await run('正在删除本机备份…', async () => { await files.deleteBackup({ path: file.path }); await refreshFiles() }) }
  function newNote(): Note { return { id: id(), title: '', body: '', todos: [], images: [], pinned: false, position: 0, createdAt: Date.now(), updatedAt: Date.now(), recordDate: localDate(), tagIds: [], deletedAt: 0 } }
  return { data, ready, bootError, processing, busy, message, imageDirectory, backups, saving, device, today, pending, backupDue, notify, boot, updateDevice, maintenance, refreshFiles, saveEntry, deleteEntry, saveNote, deleteNote, togglePin, reorder, saveAppearance, saveCategory, deleteCategory, backup, chooseBackup, restore, exportBackup, exportLedger, exportNotes, newNote, restoreItem, purge, categoryUse, mergeCategory, reorderCategories, saveTag, deleteTag, saveRule, deleteRule, skipOccurrence, deleteBackup }
})
