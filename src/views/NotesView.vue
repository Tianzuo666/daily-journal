<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Sortable from 'sortablejs'
import { useJournal, errorMessage } from '../stores/journal'
import { orderedNotes, noteDate, type Note } from '../domain'
import RecordCalendar from '../components/RecordCalendar.vue'
import SearchExcerpt from '../components/SearchExcerpt.vue'

defineOptions({ name: 'NotesView' })
const store = useJournal(), router = useRouter(), keyword = ref('')
const mode = ref<'list' | 'calendar'>('list'), sorting = ref<'manual' | 'date' | 'modified'>('manual'), from = ref(''), to = ref(''), selectedTags = ref<string[]>([]), hasImages = ref(false), hasTodo = ref(false)
const filtered = computed(() => !!(keyword.value.trim() || from.value || to.value || selectedTags.value.length || hasImages.value || hasTodo.value))
const draggable = computed(() => mode.value === 'list' && sorting.value === 'manual' && !filtered.value)
const matches = computed(() => store.data.notes.filter(n => {
  const q = keyword.value.trim().toLocaleLowerCase(), text = `${n.title}\n${n.body}\n${n.todos.map(t => t.text).join('\n')}\n${(n.tagIds ?? []).map(id => store.data.tags.find(t => t.id === id)?.name ?? '').join('\n')}`.toLocaleLowerCase()
  return !n.deletedAt && (!q || text.includes(q)) && (!from.value || noteDate(n) >= from.value) && (!to.value || noteDate(n) <= to.value) && (!selectedTags.value.length || selectedTags.value.some(id => n.tagIds?.includes(id))) && (!hasImages.value || n.images.length > 0) && (!hasTodo.value || n.todos.some(t => !t.done))
}))
function group(pinned: boolean) { const notes = orderedNotes(matches.value, pinned); if (sorting.value === 'date') notes.sort((a, b) => noteDate(b).localeCompare(noteDate(a)) || b.createdAt - a.createdAt); if (sorting.value === 'modified') notes.sort((a, b) => b.updatedAt - a.updatedAt); return notes }
const pinned = computed(() => group(true)), regular = computed(() => group(false))
function clearFilters() { keyword.value = ''; from.value = ''; to.value = ''; selectedTags.value = []; hasImages.value = false; hasTodo.value = false }
// 搜索摘要定位到命中的正文或待办，较长正文后半段也能看到匹配上下文。
function excerpt(note: Note) {
  const text = keyword.value.trim() ? `${note.body}\n${note.todos.map(t => t.text).join('\n')}`.trim() : note.body
  const index = keyword.value.trim() ? text.toLocaleLowerCase().indexOf(keyword.value.trim().toLocaleLowerCase()) : 0
  const start = Math.max(0, index - 24), end = start + Math.max(90, keyword.value.trim().length)
  return `${start ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}
const pinnedList = ref<HTMLElement>(), regularList = ref<HTMLElement>()
let sortables: Sortable[] = [], active = false
const stop = () => { sortables.forEach(sortable => sortable.destroy()); sortables = [] }
async function bindSort() {
  await nextTick(); stop()
  if (!active || mode.value !== 'list') return
  for (const [element, isPinned] of [[pinnedList.value, true], [regularList.value, false]] as const) {
    if (!element) continue
    sortables.push(Sortable.create(element, {
      handle: '.drag-handle', animation: 150, delay: 160, delayOnTouchOnly: true, touchStartThreshold: 4,
      ghostClass: 'drag-ghost', chosenClass: 'drag-chosen', disabled: !draggable.value, draggable: '.note-card',
      onEnd(event) {
        const order = [...element.children].map(child => (child as HTMLElement).dataset.id!)
        // 交回 Vue 管理 DOM，数据库保存成功后再通过数据更新显示顺序。
        event.item.remove(); element.insertBefore(event.item, element.children[event.oldIndex ?? 0] ?? null)
        if (event.oldIndex === event.newIndex) return
        void store.reorder(isPinned, order).catch(error => store.notify(errorMessage(error)))
      },
    }))
  }
}
watch([() => pinned.value.map(n => n.id).join(','), () => regular.value.map(n => n.id).join(','), draggable, mode], bindSort)
onActivated(() => { active = true; void bindSort() }); onDeactivated(() => { active = false; stop() }); onUnmounted(stop)
async function pin(noteId: string) { try { await store.togglePin(noteId) } catch (error) { store.notify(errorMessage(error)) } }
async function move(noteId: string, direction: number, isPinned: boolean) {
  const group = (isPinned ? pinned.value : regular.value).map(n => n.id), index = group.indexOf(noteId), target = index + direction
  if (target < 0 || target >= group.length || !draggable.value) return
  ;[group[index], group[target]] = [group[target], group[index]]
  try { await store.reorder(isPinned, group) } catch (error) { store.notify(errorMessage(error)) }
}
</script>

<template>
  <header class="page-header"><div><h1>我的记录</h1><p class="muted">{{ store.data.notes.filter(n => !n.deletedAt).length }} 篇 · {{ store.data.notes.filter(n => n.pinned && !n.deletedAt).length }} 篇置顶</p></div><button class="icon-button" aria-label="新增记录" @click="router.push('/notes/new')">＋</button></header>
  <div class="segmented"><button :class="{ active: mode === 'list' }" @click="mode = 'list'">列表</button><button :class="{ active: mode === 'calendar' }" @click="mode = 'calendar'">日历</button></div>
  <RecordCalendar v-if="mode === 'calendar'" />
  <template v-else>
  <label>搜索标题、正文、待办和标签<input v-model="keyword" type="search" placeholder="找一段文字…"></label>
  <details class="panel"><summary>筛选与排序 · {{ matches.length }} 篇</summary><div class="stack"><div class="pair"><label>记录日期开始<input v-model="from" type="date" min="1900-01-01"></label><label>结束<input v-model="to" type="date" min="1900-01-01"></label></div><p v-if="from && to && from > to" class="field-error">结束日期不能早于开始日期</p><label>排序<select v-model="sorting"><option value="manual">手动排序</option><option value="date">记录日期倒序</option><option value="modified">最近修改</option></select></label><div class="toolbar"><label v-for="tag in store.data.tags" :key="tag.id" class="inline-check"><input v-model="selectedTags" type="checkbox" :value="tag.id">{{ tag.name }}</label></div><p class="muted">多标签匹配任意一个；不同筛选条件同时满足。</p><label class="inline-check"><input v-model="hasImages" type="checkbox">有图片</label><label class="inline-check"><input v-model="hasTodo" type="checkbox">含未完成待办</label><button class="secondary" @click="clearFilters">清空筛选</button></div></details>
  <p class="muted" style="margin-top:15px">{{ draggable ? '置顶优先 · 拖动手柄调整组内顺序' : '置顶优先 · 当前视图不支持拖拽' }} · {{ matches.length }} 篇</p>
  <div v-if="pinned.length" class="group-label">置顶 · {{ pinned.length }}</div>
  <div ref="pinnedList" class="note-list" :class="{ searching: !draggable }">
    <article v-for="note in pinned" :key="note.id" class="note-card" :data-id="note.id">
      <button class="note-open" @click="router.push(`/notes/${note.id}`)"><h2><SearchExcerpt :text="note.title || '无标题记录'" :keyword="keyword" /></h2><p v-if="note.body || keyword.trim() && note.todos.length" class="excerpt"><SearchExcerpt :text="excerpt(note)" :keyword="keyword" /></p><p v-if="note.todos.length" class="muted">{{ note.todos.filter(t => t.done).length }}/{{ note.todos.length }} 项待办完成</p><p v-if="note.images.length" class="muted">{{ note.images.length }} 张图片</p><p class="metadata">{{ noteDate(note) }} · {{ (note.tagIds ?? []).map(id => store.data.tags.find(t => t.id === id)?.name).join(' / ') }}</p></button>
      <button class="pin-button active" aria-label="取消置顶" @click="pin(note.id)">取消</button><button class="drag-handle" aria-label="拖动排序，方向键可上下移动" @keydown.up.prevent="move(note.id, -1, true)" @keydown.down.prevent="move(note.id, 1, true)">⠿</button>
    </article>
  </div>
  <div v-if="regular.length" class="group-label">其他记录 · {{ regular.length }}</div>
  <div ref="regularList" class="note-list" :class="{ searching: !draggable }">
    <article v-for="note in regular" :key="note.id" class="note-card" :data-id="note.id">
      <button class="note-open" @click="router.push(`/notes/${note.id}`)"><h2><SearchExcerpt :text="note.title || '无标题记录'" :keyword="keyword" /></h2><p v-if="note.body || keyword.trim() && note.todos.length" class="excerpt"><SearchExcerpt :text="excerpt(note)" :keyword="keyword" /></p><p v-if="note.todos.length" class="muted">{{ note.todos.filter(t => t.done).length }}/{{ note.todos.length }} 项待办完成</p><p v-if="note.images.length" class="muted">{{ note.images.length }} 张图片</p><p class="metadata">{{ noteDate(note) }} · {{ (note.tagIds ?? []).map(id => store.data.tags.find(t => t.id === id)?.name).join(' / ') }}</p></button>
      <button class="pin-button" aria-label="置顶这篇记录" @click="pin(note.id)">置顶</button><button class="drag-handle" aria-label="拖动排序，方向键可上下移动" @keydown.up.prevent="move(note.id, -1, false)" @keydown.down.prevent="move(note.id, 1, false)">⠿</button>
    </article>
  </div>
  <div v-if="!pinned.length && !regular.length" class="empty">{{ keyword.trim() ? '没有找到相关记录' : '写下第一篇记录，留住此刻的想法。' }}</div>
  </template>
</template>
