<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Sortable from 'sortablejs'
import { useJournal, errorMessage } from '../stores/journal'
import { orderedNotes, localDate } from '../domain'

defineOptions({ name: 'NotesView' })
const store = useJournal(), router = useRouter(), keyword = ref('')
const pinned = computed(() => orderedNotes(store.data.notes, true, keyword.value)), regular = computed(() => orderedNotes(store.data.notes, false, keyword.value))
const pinnedList = ref<HTMLElement>(), regularList = ref<HTMLElement>()
let sortables: Sortable[] = [], active = false
const stop = () => { sortables.forEach(sortable => sortable.destroy()); sortables = [] }
async function bindSort() {
  await nextTick(); stop()
  if (!active) return
  for (const [element, isPinned] of [[pinnedList.value, true], [regularList.value, false]] as const) {
    if (!element) continue
    sortables.push(Sortable.create(element, {
      handle: '.drag-handle', animation: 150, delay: 160, delayOnTouchOnly: true, touchStartThreshold: 4,
      ghostClass: 'drag-ghost', chosenClass: 'drag-chosen', disabled: !!keyword.value.trim(), draggable: '.note-card',
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
watch([() => pinned.value.map(n => n.id).join(','), () => regular.value.map(n => n.id).join(','), keyword], bindSort)
onActivated(() => { active = true; void bindSort() }); onDeactivated(() => { active = false; stop() }); onUnmounted(stop)
async function pin(noteId: string) { try { await store.togglePin(noteId) } catch (error) { store.notify(errorMessage(error)) } }
async function move(noteId: string, direction: number, isPinned: boolean) {
  const group = (isPinned ? pinned.value : regular.value).map(n => n.id), index = group.indexOf(noteId), target = index + direction
  if (target < 0 || target >= group.length || keyword.value.trim()) return
  ;[group[index], group[target]] = [group[target], group[index]]
  try { await store.reorder(isPinned, group) } catch (error) { store.notify(errorMessage(error)) }
}
</script>

<template>
  <header class="page-header"><div><h1>我的记录</h1><p class="muted">{{ store.data.notes.length }} 篇 · {{ store.data.notes.filter(n => n.pinned).length }} 篇置顶</p></div><button class="icon-button" aria-label="新增记录" @click="router.push('/notes/new')">＋</button></header>
  <label>搜索标题、正文和待办<input v-model="keyword" type="search" placeholder="找一段文字…"></label>
  <p class="muted" style="margin-top:15px">{{ keyword.trim() ? '搜索结果 · 置顶优先' : '可置顶多篇 · 拖动右侧手柄调整组内顺序' }}</p>
  <div v-if="pinned.length" class="group-label">置顶 · {{ pinned.length }}</div>
  <div ref="pinnedList" class="note-list" :class="{ searching: !!keyword.trim() }">
    <article v-for="note in pinned" :key="note.id" class="note-card" :data-id="note.id">
      <button class="note-open" @click="router.push(`/notes/${note.id}`)"><h2>{{ note.title || '无标题记录' }}</h2><p v-if="note.body" class="excerpt">{{ note.body.slice(0, 90) }}</p><p v-if="note.todos.length" class="muted">{{ note.todos.filter(t => t.done).length }}/{{ note.todos.length }} 项待办完成</p><p v-if="note.images.length" class="muted">{{ note.images.length }} 张图片</p><p class="metadata">{{ localDate(new Date(note.createdAt)) }}</p></button>
      <button class="pin-button active" aria-label="取消置顶" @click="pin(note.id)">取消</button><button class="drag-handle" aria-label="拖动排序，方向键可上下移动" @keydown.up.prevent="move(note.id, -1, true)" @keydown.down.prevent="move(note.id, 1, true)">⠿</button>
    </article>
  </div>
  <div v-if="regular.length" class="group-label">其他记录 · {{ regular.length }}</div>
  <div ref="regularList" class="note-list" :class="{ searching: !!keyword.trim() }">
    <article v-for="note in regular" :key="note.id" class="note-card" :data-id="note.id">
      <button class="note-open" @click="router.push(`/notes/${note.id}`)"><h2>{{ note.title || '无标题记录' }}</h2><p v-if="note.body" class="excerpt">{{ note.body.slice(0, 90) }}</p><p v-if="note.todos.length" class="muted">{{ note.todos.filter(t => t.done).length }}/{{ note.todos.length }} 项待办完成</p><p v-if="note.images.length" class="muted">{{ note.images.length }} 张图片</p><p class="metadata">{{ localDate(new Date(note.createdAt)) }}</p></button>
      <button class="pin-button" aria-label="置顶这篇记录" @click="pin(note.id)">置顶</button><button class="drag-handle" aria-label="拖动排序，方向键可上下移动" @keydown.up.prevent="move(note.id, -1, false)" @keydown.down.prevent="move(note.id, 1, false)">⠿</button>
    </article>
  </div>
  <div v-if="!pinned.length && !regular.length" class="empty">{{ keyword.trim() ? '没有找到相关记录' : '写下第一篇记录，留住此刻的想法。' }}</div>
</template>
