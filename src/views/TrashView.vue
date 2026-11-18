<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog } from 'vant'
import { useJournal, errorMessage } from '../stores/journal'
import { amountText, type Attachment } from '../domain'
import { imageUrl } from '../native'
const store = useJournal(), router = useRouter(), photo = ref('')
const items = computed(() => [
  ...store.data.entries.filter(e => e.deletedAt).map(e => ({ id: e.id, kind: 'entry' as const, title: `${e.type === 'income' ? '收入' : '支出'} ¥${amountText(e.amountCents)}`, text: e.remark, deletedAt: e.deletedAt!, images: e.images ?? [], date: e.date, todos: [] as { text: string; done: boolean }[] })),
  ...store.data.notes.filter(n => n.deletedAt).map(n => ({ id: n.id, kind: 'note' as const, title: n.title || '无标题记录', text: n.body, deletedAt: n.deletedAt!, images: n.images, date: n.recordDate, todos: n.todos })),
].sort((a, b) => b.deletedAt - a.deletedAt))
async function restore(kind: 'entry' | 'note', id: string) { try { await store.restoreItem(kind, id); store.notify('已恢复') } catch (reason) { store.notify(errorMessage(reason)) } }
async function remove(kind?: 'entry' | 'note', id?: string) { try { await showConfirmDialog({ title: id ? '永久删除这项内容？' : '清空回收站？', message: '文字和无引用图片将永久删除，无法撤销。' }) } catch { return }; try { await store.purge(kind, id) } catch (reason) { store.notify(errorMessage(reason)) } }
onMounted(() => { void store.maintenance().catch(reason => store.notify(errorMessage(reason))) })
const url = (image: Attachment) => imageUrl(store.imageDirectory, image.file)
</script>
<template><header class="page-header"><h1>回收站</h1><button class="icon-button" @click="router.push('/settings')">‹</button></header><p class="muted">保留30天，到期后下次打开应用时清理。完整备份包含回收站内容。</p><button class="danger full" :disabled="!items.length" @click="remove()">清空回收站</button><details v-for="item in items" :key="item.kind + item.id" class="panel"><summary>{{ item.title }} · {{ item.date }}</summary><p class="muted">删除于 {{ new Date(item.deletedAt).toLocaleString('zh-CN') }} · 剩余约 {{ Math.max(0, Math.ceil((item.deletedAt + 30 * 86400000 - Date.now()) / 86400000)) }} 天</p><p class="preserve-text">{{ item.text }}</p><p v-for="(todo, index) in item.todos" :key="index">{{ todo.done ? '☑' : '☐' }} {{ todo.text }}</p><div class="attachments"><img v-for="image in item.images" :key="image.file" :src="url(image)" :alt="image.name" @click="photo = url(image)"></div><div class="toolbar"><button class="secondary" @click="restore(item.kind, item.id)">恢复</button><button class="danger" @click="remove(item.kind, item.id)">永久删除</button></div></details><p v-if="!items.length" class="empty">回收站为空</p><div v-if="photo" class="photo-viewer" @click="photo = ''"><img :src="photo" alt="回收站图片"></div></template>
