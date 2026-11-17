<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Popup as VanPopup, showConfirmDialog } from 'vant'
import { useJournal, clone, errorMessage } from '../stores/journal'
import { id, type Category, type EntryType } from '../domain'

const store = useJournal(), router = useRouter(), type = ref<EntryType>('expense')
const categories = computed(() => store.data.categories.filter(c => c.type === type.value).sort((a, b) => a.position - b.position))
const editor = ref<Category | null>(null), error = ref(''), saving = ref(false)
function edit(category?: Category) { editor.value = category ? clone(category) : { id: id(), name: '', type: type.value, position: categories.value.length ? Math.max(...categories.value.map(c => c.position)) + 1 : 0 }; error.value = '' }
async function save() { if (!editor.value || saving.value) return; saving.value = true; try { await store.saveCategory(editor.value); editor.value = null } catch (reason) { error.value = errorMessage(reason) } finally { saving.value = false } }
async function remove(category: Category) {
  try { await showConfirmDialog({ title: `删除“${category.name}”？`, message: '有账单使用的分类需要先修改相关账单。', confirmButtonText: '删除', cancelButtonText: '取消' }) } catch { return }
  try { await store.deleteCategory(category.id) } catch (reason) { store.notify(errorMessage(reason)) }
}
function back(event: Event) { if (editor.value) { event.preventDefault(); if (!saving.value) editor.value = null } }
onMounted(() => window.addEventListener('journal-back', back)); onUnmounted(() => window.removeEventListener('journal-back', back))
</script>

<template>
  <header class="page-header"><div><h1>记账分类</h1><p class="muted">修改名称会同步显示在历史账单中</p></div><button class="icon-button" aria-label="返回设置" @click="router.push('/settings')">‹</button></header>
  <div class="segmented"><button :class="{ active: type === 'expense' }" @click="type = 'expense'">支出分类</button><button :class="{ active: type === 'income' }" @click="type = 'income'">收入分类</button></div>
  <div v-for="category in categories" :key="category.id" class="category-row"><span>{{ category.name }}</span><button class="secondary" @click="edit(category)">修改</button><button class="danger" @click="remove(category)">删除</button></div>
  <button class="primary full" style="margin-top:24px" @click="edit()">＋ 添加分类</button>
  <VanPopup :show="!!editor" position="bottom" round :close-on-click-overlay="!saving" @update:show="value => { if (!value && !saving) editor = null }"><section v-if="editor" class="sheet"><header class="page-header"><h2>{{ categories.some(c => c.id === editor?.id) ? '修改分类' : '新增分类' }}</h2><button class="icon-button" :disabled="saving" aria-label="关闭" @click="editor = null">×</button></header><form class="stack" @submit.prevent="save"><label>分类名称<input v-model="editor.name" maxlength="30" placeholder="输入分类名称" required></label><p v-if="error" class="field-error" role="alert">{{ error }}</p><button class="primary full" :disabled="saving">{{ saving ? '正在保存…' : '保存分类' }}</button></form></section></VanPopup>
</template>
