<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { App as CapacitorApp } from '@capacitor/app'
import { showConfirmDialog } from 'vant'
import { useJournal, clone, errorMessage } from '../stores/journal'
import { id, localDate } from '../domain'
import { files, imageUrl, native } from '../native'

const route = useRoute(), router = useRouter(), store = useJournal()
const existing = store.data.notes.find(n => n.id === route.params.id)
const draft = ref(existing ? clone(existing) : store.newNote()), missing = route.params.id !== 'new' && !existing
const saveError = ref(''), dirty = ref(false), saving = ref(false), picking = ref(false), leaving = ref(false), photo = ref('')
const persisted = computed(() => store.data.notes.some(n => n.id === draft.value.id))
let timer: ReturnType<typeof setTimeout> | undefined, saveQueue: Promise<void> = Promise.resolve(), deleting = false
let removePause: (() => Promise<void>) | undefined
const currentFingerprint = () => JSON.stringify(draft.value)
let savedFingerprint = currentFingerprint()
watch(draft, () => { dirty.value = currentFingerprint() !== savedFingerprint || saving.value; clearTimeout(timer); timer = setTimeout(() => { void flush().catch(() => undefined) }, 600) }, { deep: true })
function flush(): Promise<void> {
  clearTimeout(timer)
  if (missing || deleting) return Promise.resolve()
  const payload = clone(draft.value), fingerprint = JSON.stringify(payload)
  const result = saveQueue.catch(() => undefined).then(async () => {
    // 比较放在队列内，防止较早的保存尚在进行时，“改回原文”被误判为无需保存。
    if (fingerprint === savedFingerprint) { dirty.value = currentFingerprint() !== savedFingerprint; saveError.value = ''; return }
    saving.value = true
    try { await store.saveNote(payload); savedFingerprint = fingerprint; dirty.value = currentFingerprint() !== savedFingerprint; saveError.value = '' }
    catch (error) { saveError.value = errorMessage(error); throw error }
    finally { saving.value = false }
  })
  saveQueue = result
  return result
}
async function done() { try { await flush(); await router.push('/notes') } catch { store.notify('记录尚未保存，请先处理保存错误') } }
async function addTodo() { draft.value.todos.push({ id: id(), text: '', done: false }); await nextTick(); document.querySelector<HTMLInputElement>('.check-row:last-child input[type=text]')?.focus() }
async function pickImages() {
  if (!native) { store.notify('添加本地图片需要在安卓版本中使用'); return }
  picking.value = true
  try { const result = await files.pickImages(); if (result.images?.length) { draft.value.images.push(...result.images); await flush() } }
  catch (error) { store.notify(errorMessage(error)) } finally { picking.value = false }
}
async function removeNote() {
  try { await showConfirmDialog({ title: '删除这篇记录？', message: '文字、图片和待办会一起移除。', confirmButtonText: '删除', cancelButtonText: '保留' }) } catch { return }
  deleting = true; clearTimeout(timer)
  try { await saveQueue.catch(() => undefined); await store.deleteNote(draft.value.id); await router.replace('/notes') }
  catch (error) { deleting = false; store.notify(errorMessage(error)) }
}
function back(event: Event) { if (photo.value) { event.preventDefault(); photo.value = '' } }
onBeforeRouteLeave(async () => { if (picking.value) return false; leaving.value = true; try { await flush(); return true } catch { leaving.value = false; store.notify('保存失败，已留在编辑页，请重试'); return false } })
onMounted(async () => {
  window.addEventListener('journal-back', back)
  if (native) { const listener = await CapacitorApp.addListener('pause', () => { void flush().catch(() => undefined) }); removePause = () => listener.remove() }
})
onUnmounted(() => { clearTimeout(timer); window.removeEventListener('journal-back', back); void removePause?.() })
</script>

<template>
  <div v-if="missing" class="empty">记录不存在。<button class="secondary" @click="router.replace('/notes')">返回记录</button></div>
  <template v-else>
    <header class="page-header editor-header"><button class="icon-button" aria-label="保存并返回" :disabled="picking || leaving" @click="done">‹</button><span class="muted">{{ saving ? '正在保存…' : saveError ? '保存失败' : dirty ? '待保存' : '已保存' }}</span><button class="primary" :disabled="picking || leaving" @click="done">完成</button></header>
    <fieldset :disabled="picking || leaving" style="border:0;margin:0;padding:0;min-width:0">
    <p class="muted">{{ localDate(new Date(draft.createdAt)) }} · {{ draft.pinned ? '已置顶' : '记录' }}</p>
    <label><span class="muted">标题</span><input v-model="draft.title" class="editor-title" placeholder="给这篇记录起个名字" maxlength="200"></label>
    <label><span class="muted">正文</span><textarea v-model="draft.body" class="editor-body" placeholder="写下此刻想记住的事…" maxlength="1000000"></textarea></label>
    <div class="stack" style="gap:10px"><div v-for="(todo, index) in draft.todos" :key="todo.id" class="check-row"><input v-model="todo.done" type="checkbox" :aria-label="`完成待办：${todo.text}`"><input v-model="todo.text" type="text" :class="{ done: todo.done }" maxlength="1000" placeholder="待办内容" aria-label="待办内容"><button aria-label="删除待办" @click="draft.todos.splice(index, 1)">×</button></div></div>
    <div class="attachments" style="margin-top:20px"><div v-for="(image, index) in draft.images" :key="image.file" class="attachment"><img :src="imageUrl(store.imageDirectory, image.file)" :alt="image.name" loading="lazy" @click="photo = imageUrl(store.imageDirectory, image.file)"><button :aria-label="`移除图片${index + 1}`" @click="draft.images.splice(index, 1)">×</button></div></div>
    <div class="toolbar" style="margin-top:20px"><button class="secondary" @click="addTodo">＋ 待办</button><button class="secondary" :disabled="picking" @click="pickImages">{{ picking ? '正在添加…' : '＋ 图片' }}</button></div>
    <p v-if="saveError" class="field-error" role="alert" style="margin-top:20px">{{ saveError }} <button class="secondary" @click="flush().catch(() => undefined)">重试保存</button></p>
    <button v-if="persisted" class="danger full" style="margin-top:35px" :disabled="picking" @click="removeNote">删除这篇记录</button>
    </fieldset>
    <div v-if="photo" class="photo-viewer" role="dialog" aria-label="图片预览" @click.self="photo = ''"><img :src="photo" alt="记录图片"><button aria-label="关闭图片预览" @click="photo = ''">×</button></div>
  </template>
</template>
