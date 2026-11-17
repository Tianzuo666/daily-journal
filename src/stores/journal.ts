import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { emptySnapshot, id, localDate, validDate, MAX_CENTS, type Entry, type Note, type Category, type Appearance } from '../domain'
import { initialize, write, replaceAll, categoryStatement, entryStatement, noteStatement, appearanceStatement, type Statement } from '../data/database'
import { makeManifest, parseManifest, validateAppearance } from '../backup-format'
import { files, native, type BackupFile, type StagedBackup } from '../native'

export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

export const useJournal = defineStore('journal', () => {
  const data = ref(emptySnapshot())
  const ready = ref(false), bootError = ref(''), processing = ref(''), message = ref('')
  const imageDirectory = ref(''), backups = ref<BackupFile[]>([])
  const saving = ref(0)
  const busy = computed(() => !!processing.value)
  let tail: Promise<unknown> = Promise.resolve()
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
    try { const loaded = await initialize(); parseManifest(makeManifest(loaded)); data.value = loaded; await refreshFiles(); ready.value = true } catch (error) { bootError.value = errorMessage(error) }
  }
  async function saveEntry(input: Entry) {
    const entry = clone(input)
    await exclusive(async () => {
      const category = data.value.categories.find(c => c.id === entry.categoryId)
      if (!category || category.type !== entry.type) throw new Error('请选择与收支类型匹配的分类')
      if (!Number.isSafeInteger(entry.amountCents) || entry.amountCents < 1 || entry.amountCents > MAX_CENTS || !validDate(entry.date)) throw new Error('金额或日期无效')
      await write([entryStatement(entry)])
      data.value = { ...data.value, entries: [...data.value.entries.filter(e => e.id !== entry.id), entry] }
    })
  }
  async function deleteEntry(entryId: string) {
    await exclusive(async () => {
      await write([{ statement: 'DELETE FROM entries WHERE id=?', values: [entryId] }])
      data.value = { ...data.value, entries: data.value.entries.filter(e => e.id !== entryId) }
    })
  }
  async function removeUnusedImages(names: string[]) {
    if (!native || !names.length) return
    const used = new Set(data.value.notes.flatMap(n => n.images.map(i => i.file)))
    try { await files.removeImages({ images: names.filter(name => !used.has(name)) }) } catch { /* 数据已落盘；清理失败只保留多余文件，不影响记录。 */ }
  }
  async function saveNote(input: Note) {
    const note = clone(input)
    if (!note.title.trim() && !note.body.trim() && !note.todos.some(t => t.text.trim()) && !note.images.length && !data.value.notes.some(n => n.id === note.id)) return
    saving.value++
    try {
      await exclusive(async () => {
        const previous = data.value.notes.find(n => n.id === note.id)
        const notes = clone(data.value.notes.filter(n => n.id !== note.id))
        const statements: Statement[] = []
        if (!previous) {
          note.position = 0
          notes.filter(other => !other.pinned).sort((a, b) => a.position - b.position || b.createdAt - a.createdAt).forEach((other, index) => {
            other.position = index + 1; statements.push({ statement: 'UPDATE notes SET position=? WHERE id=?', values: [other.position, other.id] })
          })
        } else { note.pinned = previous.pinned; note.position = previous.position }
        note.updatedAt = Date.now()
        statements.push(noteStatement(note))
        await write(statements)
        data.value = { ...data.value, notes: [...notes, note] }
        await removeUnusedImages((previous?.images ?? []).filter(i => !note.images.some(n => n.file === i.file)).map(i => i.file))
      })
    } finally { saving.value-- }
  }
  async function deleteNote(noteId: string) {
    await exclusive(async () => {
      const previous = data.value.notes.find(n => n.id === noteId)
      await write([{ statement: 'DELETE FROM notes WHERE id=?', values: [noteId] }])
      data.value = { ...data.value, notes: data.value.notes.filter(n => n.id !== noteId) }
      await removeUnusedImages(previous?.images.map(i => i.file) ?? [])
    })
  }
  async function togglePin(noteId: string) {
    await exclusive(async () => {
      const notes = clone(data.value.notes), note = notes.find(n => n.id === noteId)
      if (!note) return
      note.pinned = !note.pinned
      notes.filter(other => other.id !== note.id && other.pinned === note.pinned).sort((a, b) => a.position - b.position || b.createdAt - a.createdAt).forEach((other, index) => { other.position = index + 1 })
      note.position = 0
      await write(notes.filter(n => n.pinned === note.pinned).map(noteStatement))
      data.value = { ...data.value, notes }
    })
  }
  async function reorder(pinned: boolean, order: string[]) {
    await exclusive(async () => {
      const notes = clone(data.value.notes), group = notes.filter(n => n.pinned === pinned)
      if (order.length !== group.length || new Set(order).size !== group.length || !group.every(n => order.includes(n.id))) throw new Error('记录列表已变化，请重新排序')
      group.forEach(n => { n.position = order.indexOf(n.id) })
      await write(group.map(noteStatement)); data.value = { ...data.value, notes }
    })
  }
  async function saveAppearance(input: Appearance) {
    const appearance = clone(input); validateAppearance(appearance)
    await exclusive(async () => { await write([appearanceStatement(appearance)]); data.value = { ...data.value, appearance } })
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
    })
  }
  async function deleteCategory(categoryId: string) {
    await exclusive(async () => {
      if (data.value.categories.length <= 1) throw new Error('至少需要保留一个记账分类')
      if (data.value.entries.some(e => e.categoryId === categoryId)) throw new Error('这个分类仍有账单，请先修改相关账单')
      await write([{ statement: 'DELETE FROM categories WHERE id=?', values: [categoryId] }])
      data.value = { ...data.value, categories: data.value.categories.filter(c => c.id !== categoryId) }
    })
  }
  async function createBackupInside(): Promise<BackupFile> {
    if (!native) throw new Error('备份需要在安卓版本中使用')
    const backup = await files.createBackup({ manifest: makeManifest(data.value) })
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
      const previousImages = data.value.notes.flatMap(note => note.images.map(image => image.file))
      data.value = manifest.data
      await removeUnusedImages(previousImages)
      await refreshFiles()
      notify(`恢复完成，覆盖前备份：${recovery.name}`)
      try { await files.discardStage({ token: stage.token }) } catch { /* 失败只留下临时文件，原生层下次启动时清理。 */ }
    })
  }
  async function exportBackup(backupFile: BackupFile) {
    await run('请选择备份保存位置…', () => files.exportFile({ path: backupFile.path, name: backupFile.name, mime: 'application/zip' }))
  }
  async function exportLedger() {
    await run('正在导出账单…', async () => {
      if (!native) throw new Error('导出需要在安卓版本中使用')
      const cell = (value: string) => `"${(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`
      const rows = [['日期', '类型', '金额（元）', '分类', '备注'], ...data.value.entries.slice().sort((a, b) => b.date.localeCompare(a.date)).map(e => [e.date, e.type === 'income' ? '收入' : '支出', (e.amountCents / 100).toFixed(2), data.value.categories.find(c => c.id === e.categoryId)?.name ?? '', e.remark])]
      const name = `日常记-账单-${localDate()}.csv`
      const file = await files.createTextExport({ name, content: '\ufeff' + rows.map(row => row.map(cell).join(',')).join('\r\n') })
      await files.exportFile({ path: file.path, name, mime: 'text/csv' })
    })
  }
  async function exportNotes() {
    await run('正在导出记录和图片…', async () => {
      if (!native) throw new Error('导出需要在安卓版本中使用')
      const file = await files.createNotesExport({ notes: JSON.stringify(data.value.notes) })
      await files.exportFile({ path: file.path, name: `日常记-记录-${localDate()}.zip`, mime: 'application/zip' })
    })
  }
  function newNote(): Note { return { id: id(), title: '', body: '', todos: [], images: [], pinned: false, position: 0, createdAt: Date.now(), updatedAt: Date.now() } }
  return { data, ready, bootError, processing, busy, message, imageDirectory, backups, saving, notify, boot, refreshFiles, saveEntry, deleteEntry, saveNote, deleteNote, togglePin, reorder, saveAppearance, saveCategory, deleteCategory, backup, chooseBackup, restore, exportBackup, exportLedger, exportNotes, newNote }
})
