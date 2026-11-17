<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { Button as VanButton, Popup as VanPopup, showConfirmDialog } from 'vant'
import { useJournal, clone, errorMessage } from '../stores/journal'
import { amountText, cents, id, localDate, money, monthFilter, validateFilter, validDate, type Entry } from '../domain'
import { findEntries } from '../data/database'

defineOptions({ name: 'LedgerView' })
const store = useJournal(), filter = ref(monthFilter()), draftFilter = reactive(monthFilter())
const showFilter = ref(false), filterError = ref(''), tab = ref<'list' | 'stats'>('list'), statsType = ref<'expense' | 'income'>('expense')
const entries = ref<Entry[]>([]), querying = ref(false), limit = ref(60)
const editor = ref<Entry | null>(null), amount = ref(''), formError = ref(''), submitting = ref(false)
const categories = computed(() => store.data.categories.filter(c => c.type === editor.value?.type).sort((a, b) => a.position - b.position))
let queryId = 0
async function refresh() {
  const request = ++queryId
  querying.value = true
  try { const result = await findEntries(filter.value, store.data.entries); if (request === queryId) entries.value = result }
  catch (error) { store.notify(errorMessage(error)) }
  finally { if (request === queryId) querying.value = false }
}
watch([filter, () => store.data.entries], () => { limit.value = 60; void refresh() }, { deep: true, immediate: true })
const income = computed(() => entries.value.filter(e => e.type === 'income').reduce((sum, e) => sum + e.amountCents, 0))
const expense = computed(() => entries.value.filter(e => e.type === 'expense').reduce((sum, e) => sum + e.amountCents, 0))
const breakdown = computed(() => {
  const map = new Map<string, number>()
  for (const entry of entries.value) if (entry.type === statsType.value) map.set(entry.categoryId, (map.get(entry.categoryId) ?? 0) + entry.amountCents)
  const total = statsType.value === 'income' ? income.value : expense.value
  return [...map].map(([categoryId, sum]) => ({ categoryId, sum, ratio: total ? sum / total : 0 })).sort((a, b) => b.sum - a.sum)
})
const categoryName = (categoryId: string) => store.data.categories.find(c => c.id === categoryId)?.name ?? '未分类'
function openFilter() { Object.assign(draftFilter, clone(filter.value)); filterError.value = ''; showFilter.value = true }
function applyFilter() {
  try { validateFilter(draftFilter); filter.value = clone(draftFilter); if (filter.value.type) statsType.value = filter.value.type; showFilter.value = false }
  catch (error) { filterError.value = errorMessage(error) }
}
function openEntry(entry?: Entry) {
  editor.value = entry ? clone(entry) : { id: id(), type: 'expense', amountCents: 0, date: localDate(), categoryId: store.data.categories.find(c => c.type === 'expense')?.id ?? '', remark: '', createdAt: Date.now() }
  amount.value = entry ? amountText(entry.amountCents) : ''; formError.value = ''
}
function changeType(type: Entry['type']) {
  if (!editor.value || editor.value.type === type) return
  editor.value.type = type; editor.value.categoryId = store.data.categories.find(c => c.type === type)?.id ?? ''
}
async function saveEntry() {
  if (!editor.value || submitting.value) return
  submitting.value = true
  try {
    editor.value.amountCents = cents(amount.value)
    if (!validDate(editor.value.date)) throw new Error('请选择有效日期')
    await store.saveEntry(editor.value); editor.value = null; store.notify('账单已保存')
  } catch (error) { formError.value = errorMessage(error) } finally { submitting.value = false }
}
async function removeEntry() {
  if (!editor.value) return
  try { await showConfirmDialog({ title: '删除这笔账单？', message: '删除后会从明细和统计中移除。', confirmButtonText: '删除', cancelButtonText: '保留' }) } catch { return }
  submitting.value = true
  try { await store.deleteEntry(editor.value.id); editor.value = null; store.notify('账单已删除') } catch (error) { formError.value = errorMessage(error) } finally { submitting.value = false }
}
let active = false
const back = (event: Event) => { if (active && (editor.value || showFilter.value)) { event.preventDefault(); if (!submitting.value) { editor.value = null; showFilter.value = false } } }
onMounted(() => window.addEventListener('journal-back', back)); onUnmounted(() => window.removeEventListener('journal-back', back))
onActivated(() => { active = true }); onDeactivated(() => { active = false })
</script>

<template>
  <header class="page-header"><div><h1>我的记账</h1><p class="muted">{{ filter.from || '不限开始' }} 至 {{ filter.to || '不限结束' }}</p></div><button class="icon-button" aria-label="筛选账单" @click="openFilter">☷</button></header>
  <div v-if="filter.type || filter.categoryId || filter.min || filter.max || filter.keyword" class="chips">
    <span v-if="filter.type" class="chip">{{ filter.type === 'income' ? '收入' : '支出' }}</span><span v-if="filter.categoryId" class="chip">{{ categoryName(filter.categoryId) }}</span>
    <span v-if="filter.min || filter.max" class="chip">¥ {{ filter.min || '0' }} ～ {{ filter.max || '不限' }}</span><span v-if="filter.keyword" class="chip">{{ filter.keyword }}</span>
  </div>
  <section class="summary" aria-label="筛选范围内的收支汇总"><span class="caption">结余</span><div class="balance">¥ {{ money(income - expense) }}</div><div class="pair"><div><span class="caption">收入</span><p>¥ {{ money(income) }}</p></div><div><span class="caption">支出</span><p>¥ {{ money(expense) }}</p></div></div></section>
  <div class="tabs"><button :class="{ active: tab === 'list' }" @click="tab = 'list'">明细</button><button :class="{ active: tab === 'stats' }" @click="tab = 'stats'">统计</button></div>
  <template v-if="tab === 'list'">
    <div class="row muted"><span>{{ querying ? '正在查询…' : `共 ${entries.length} 笔` }}</span><span>点击账单编辑</span></div>
    <button v-for="entry in entries.slice(0, limit)" :key="entry.id" class="ledger-row" @click="openEntry(entry)"><span class="category-symbol">{{ categoryName(entry.categoryId).slice(0, 1) }}</span><span class="grow"><span>{{ categoryName(entry.categoryId) }}</span><div class="description">{{ entry.date }} · {{ entry.remark || '无备注' }}</div></span><span class="number" :class="{ income: entry.type === 'income' }">{{ entry.type === 'income' ? '+' : '−' }}{{ money(entry.amountCents) }}</span></button>
    <div v-if="!entries.length && !querying" class="empty">还没有符合条件的账单</div>
    <button v-if="entries.length > limit" class="secondary full" @click="limit += 60">加载更多</button>
  </template>
  <template v-else>
    <div class="segmented"><button :class="{ active: statsType === 'expense' }" @click="statsType = 'expense'">支出分类</button><button :class="{ active: statsType === 'income' }" @click="statsType = 'income'">收入分类</button></div>
    <div v-for="item in breakdown" :key="item.categoryId" class="stat-row"><div class="stat-label"><span>{{ categoryName(item.categoryId) }}</span><span>{{ (item.ratio * 100).toFixed(1) }}% · ¥ {{ money(item.sum) }}</span></div><div class="stat-bar" role="img" :aria-label="`${categoryName(item.categoryId)}占比${(item.ratio * 100).toFixed(1)}%`"><span :style="{ width: `${item.ratio * 100}%` }"></span></div></div>
    <div v-if="!breakdown.length" class="empty">当前筛选范围内没有{{ statsType === 'income' ? '收入' : '支出' }}</div>
    <p class="muted" style="margin-top:20px">统计跟随当前筛选条件。</p>
  </template>
  <div class="floating-action"><button class="primary full" @click="openEntry()">＋ 记一笔</button></div>

  <VanPopup v-model:show="showFilter" position="bottom" round>
    <section class="sheet"><header class="page-header"><h2>筛选账单</h2><button class="icon-button" aria-label="关闭筛选" @click="showFilter = false">×</button></header><div class="stack">
      <div class="pair"><label>开始日期<input v-model="draftFilter.from" type="date" min="1900-01-01"></label><label>结束日期<input v-model="draftFilter.to" type="date" min="1900-01-01"></label></div>
      <div class="pair"><label>类型<select v-model="draftFilter.type" @change="draftFilter.categoryId = ''"><option value="">全部</option><option value="expense">支出</option><option value="income">收入</option></select></label><label>分类<select v-model="draftFilter.categoryId"><option value="">全部分类</option><option v-for="c in store.data.categories.filter(c => !draftFilter.type || c.type === draftFilter.type)" :key="c.id" :value="c.id">{{ c.name }}{{ !draftFilter.type ? c.type === 'income' ? '（收入）' : '（支出）' : '' }}</option></select></label></div>
      <div><p class="muted">单笔金额（元，包含上下限）</p><div class="pair" style="margin-top:8px"><label>最低金额<input v-model="draftFilter.min" inputmode="decimal" placeholder="不限"></label><label>最高金额<input v-model="draftFilter.max" inputmode="decimal" placeholder="不限"></label></div></div>
      <label>备注关键词<input v-model="draftFilter.keyword" maxlength="500" placeholder="例如：咖啡"></label><p v-if="filterError" class="field-error" role="alert">{{ filterError }}</p>
      <div class="pair"><button class="secondary" @click="Object.assign(draftFilter, monthFilter()); filterError = ''">重置为本月</button><button class="primary" @click="applyFilter">应用筛选</button></div>
    </div></section>
  </VanPopup>
  <VanPopup :show="!!editor" position="bottom" round :close-on-click-overlay="!submitting" @update:show="value => { if (!value && !submitting) editor = null }">
    <section v-if="editor" class="sheet"><header class="page-header"><h2>{{ store.data.entries.some(e => e.id === editor?.id) ? '编辑账单' : '记一笔' }}</h2><button class="icon-button" :disabled="submitting" aria-label="关闭账单编辑" @click="editor = null">×</button></header><form class="stack" @submit.prevent="saveEntry">
      <div class="segmented"><button type="button" :disabled="submitting" :class="{ active: editor.type === 'expense' }" @click="changeType('expense')">支出</button><button type="button" :disabled="submitting" :class="{ active: editor.type === 'income' }" @click="changeType('income')">收入</button></div>
      <label>金额（元）<input v-model="amount" :disabled="submitting" inputmode="decimal" placeholder="0.00" required></label>
      <div class="pair"><label>分类<select v-model="editor.categoryId" :disabled="submitting" required><option v-if="!categories.length" value="">请先在设置中添加分类</option><option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option></select></label><label>日期<input v-model="editor.date" :disabled="submitting" type="date" min="1900-01-01" required></label></div>
      <label>备注<textarea v-model="editor.remark" :disabled="submitting" maxlength="500" rows="2" placeholder="这笔钱用在了哪里"></textarea></label>
      <p v-if="formError" class="field-error" role="alert">{{ formError }}</p><VanButton native-type="submit" type="primary" block round :loading="submitting">保存账单</VanButton>
      <button v-if="store.data.entries.some(e => e.id === editor?.id)" type="button" class="danger" :disabled="submitting" @click="removeEntry">删除这笔账单</button>
    </form></section>
  </VanPopup>
</template>
