<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Popup as VanPopup, showConfirmDialog } from 'vant'
import { useJournal, clone, errorMessage } from '../stores/journal'
import { id, type Category, type EntryType } from '../domain'
import Sortable from 'sortablejs'
import { native } from '../native'

const store = useJournal(), router = useRouter(), type = ref<EntryType>('expense')
const categories = computed(() => store.data.categories.filter(c => c.type === type.value).sort((a, b) => a.position - b.position))
const editor = ref<Category | null>(null), error = ref(''), saving = ref(false)
const source = ref<Category | null>(null), targetId = ref(''), categoryList = ref<HTMLElement>()
let sortable: Sortable | undefined, disposed = false
async function bindSort() {
  await nextTick(); sortable?.destroy()
  if (disposed || !categoryList.value) return
  const element = categoryList.value
  sortable = Sortable.create(element, { handle: '.category-handle', animation: 150, delay: 160, delayOnTouchOnly: true,
    onEnd(event) {
      const order = [...element.children].map(child => (child as HTMLElement).dataset.id!)
      event.item.remove(); element.insertBefore(event.item, element.children[event.oldIndex ?? 0] ?? null)
      if (event.oldIndex !== event.newIndex) void store.reorderCategories(type.value, order).catch(reason => store.notify(errorMessage(reason)))
    },
  })
}
watch(() => categories.value.map(c => c.id).join(','), bindSort)
async function merge() {
  if (!source.value || saving.value) return
  try { await showConfirmDialog({ title: `合并“${source.value.name}”？`, message: '先生成保护备份，再迁移全部账单、回收站和周期引用。无单步撤销；整体恢复会覆盖之后的数据。', confirmButtonText: '备份并合并' }) } catch { return }
  saving.value = true
  try { await store.mergeCategory(source.value.id, targetId.value); source.value = null } catch (reason) { error.value = errorMessage(reason) } finally { saving.value = false }
}
function edit(category?: Category) { editor.value = category ? clone(category) : { id: id(), name: '', type: type.value, position: categories.value.length ? Math.max(...categories.value.map(c => c.position)) + 1 : 0 }; error.value = '' }
async function save() { if (!editor.value || saving.value) return; saving.value = true; try { await store.saveCategory(editor.value); editor.value = null } catch (reason) { error.value = errorMessage(reason) } finally { saving.value = false } }
async function remove(category: Category) {
  try { await showConfirmDialog({ title: `删除“${category.name}”？`, message: '有账单使用的分类需要先修改相关账单。', confirmButtonText: '删除', cancelButtonText: '取消' }) } catch { return }
  try { await store.deleteCategory(category.id) } catch (reason) { store.notify(errorMessage(reason)) }
}
function back(event: Event) { if (editor.value || source.value) { event.preventDefault(); if (!saving.value) { editor.value = null; source.value = null } } }
onMounted(() => { window.addEventListener('journal-back', back); void bindSort() }); onUnmounted(() => { disposed = true; sortable?.destroy(); window.removeEventListener('journal-back', back) })
</script>

<template>
  <header class="page-header"><div><h1>记账分类</h1><p class="muted">修改名称会同步显示在历史账单中</p></div><button class="icon-button" aria-label="返回设置" @click="router.push('/settings')">‹</button></header>
  <div class="segmented"><button :class="{ active: type === 'expense' }" @click="type = 'expense'">支出分类</button><button :class="{ active: type === 'income' }" @click="type = 'income'">收入分类</button></div>
  <p class="muted">拖动手柄排序；合并需要在安卓生成保护备份。</p>
  <div ref="categoryList"><div v-for="category in categories" :key="category.id" :data-id="category.id" class="category-row"><button class="category-handle" aria-label="拖动分类排序">⠿</button><div class="grow"><span>{{ category.name }}</span><p class="muted">{{ store.categoryUse(category.id).active }} 笔 · 回收站 {{ store.categoryUse(category.id).trash }} · 规则 {{ store.categoryUse(category.id).rules }} · 期次 {{ store.categoryUse(category.id).periods }}</p></div><button class="text-link" @click="edit(category)">修改</button><button class="text-link" :disabled="!native" @click="source = category; targetId = ''; error = ''">合并</button><button class="danger" @click="remove(category)">删除</button></div></div>
  <button class="primary full" style="margin-top:24px" @click="edit()">＋ 添加分类</button>
  <VanPopup :show="!!source" position="bottom" round :close-on-click-overlay="!saving" @update:show="value => { if (!value && !saving) source = null }"><section v-if="source" class="sheet stack"><h2>合并 {{ source.name }}</h2><p class="muted">正常 {{ store.categoryUse(source.id).active }} 笔，回收站 {{ store.categoryUse(source.id).trash }} 笔，周期规则 {{ store.categoryUse(source.id).rules }} 条，期次 {{ store.categoryUse(source.id).periods }} 个。源分类将移除。</p><label>目标分类<select v-model="targetId"><option value="">请选择同类型分类</option><option v-for="category in categories.filter(c => c.id !== source?.id)" :key="category.id" :value="category.id">{{ category.name }}</option></select></label><p v-if="error" class="field-error">{{ error }}</p><button class="primary" :disabled="saving || !targetId" @click="merge">备份并合并</button><button class="secondary" :disabled="saving" @click="source = null">取消</button></section></VanPopup>
  <VanPopup :show="!!editor" position="bottom" round :close-on-click-overlay="!saving" @update:show="value => { if (!value && !saving) editor = null }"><section v-if="editor" class="sheet"><header class="page-header"><h2>{{ categories.some(c => c.id === editor?.id) ? '修改分类' : '新增分类' }}</h2><button class="icon-button" :disabled="saving" aria-label="关闭" @click="editor = null">×</button></header><form class="stack" @submit.prevent="save"><label>分类名称<input v-model="editor.name" maxlength="30" placeholder="输入分类名称" required></label><p v-if="error" class="field-error" role="alert">{{ error }}</p><button class="primary full" :disabled="saving">{{ saving ? '正在保存…' : '保存分类' }}</button></form></section></VanPopup>
</template>
