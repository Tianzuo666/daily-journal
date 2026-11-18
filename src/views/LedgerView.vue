<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { Button as VanButton, Popup as VanPopup, showConfirmDialog } from 'vant'
import { useJournal, clone, errorMessage } from '../stores/journal'
import { amountText, cents, groupEntriesByDay, id, localDate, money, monthBounds, monthFilter, validateFilter, validDate, type Entry, type LedgerFilter, type EntryDayGroup } from '../domain'
import { findEntries } from '../data/database'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { nextTick } from 'vue'
import AttachmentEditor from '../components/AttachmentEditor.vue'
import TrendPanel from '../components/TrendPanel.vue'

defineOptions({ name: 'LedgerView' })
const store = useJournal(), filter = ref(monthFilter()), draftFilter = reactive(monthFilter())
const route = useRoute(), router = useRouter(), amountInput = ref<HTMLInputElement>(), picking = ref(false), occurrenceId = ref('')
const showFilter = ref(false), filterError = ref(''), tab = ref<'list' | 'stats'>('list'), statsType = ref<'expense' | 'income'>('expense')
const trendReturn = ref<LedgerFilter | null>(null)
const recentPeriod = ref<6 | 12 | null>(null), rangeBeforeRecent = ref<{ from: string; to: string } | null>(null)
const defaultRange = computed(() => monthBounds(store.today.slice(0, 7)))
const hasDetailFilters = computed(() => !!(filter.value.categoryIds.length || filter.value.min.trim() || filter.value.max.trim() || filter.value.keyword.trim()))
const hasActiveFilters = computed(() => filter.value.from !== defaultRange.value.from || filter.value.to !== defaultRange.value.to || filter.value.type !== 'expense' || hasDetailFilters.value)
const filterCategories = computed(() => store.data.categories.filter(c => !draftFilter.type || c.type === draftFilter.type).sort((a, b) => a.type.localeCompare(b.type) || a.position - b.position))
const entries = ref<Entry[]>([]), querying = ref(false), queryError = ref(''), limit = ref(60)
const editor = ref<Entry | null>(null), amount = ref(''), formError = ref(''), submitting = ref(false)
const editorImages = computed({ get: () => editor.value?.images ?? [], set: images => { if (editor.value) editor.value.images = images } })
const categories = computed(() => store.data.categories.filter(c => c.type === editor.value?.type).sort((a, b) => a.position - b.position))
let queryId = 0
async function refresh() {
  const request = ++queryId
  querying.value = true; queryError.value = ''
  try { const result = await findEntries(filter.value, store.data.entries); if (request === queryId) entries.value = result }
  catch (error) { if (request === queryId) { entries.value = []; queryError.value = errorMessage(error); store.notify(queryError.value) } }
  finally { if (request === queryId) querying.value = false }
}
watch([filter, () => store.data.entries], () => { limit.value = 60; void refresh() }, { deep: true, immediate: true })
const income = computed(() => entries.value.filter(e => e.type === 'income').reduce((sum, e) => sum + e.amountCents, 0))
const expense = computed(() => entries.value.filter(e => e.type === 'expense').reduce((sum, e) => sum + e.amountCents, 0))
const dailyGroups = computed(() => groupEntriesByDay(entries.value))
// 以整天为单位加载，跨过条数门槛时也展示完整一天，保证日小计与所见账单一致。
const visibleGroups = computed(() => {
  const groups: EntryDayGroup[] = []; let count = 0
  for (const group of dailyGroups.value) { if (count >= limit.value) break; groups.push(group); count += group.entries.length }
  return groups
})
const visibleEntryCount = computed(() => visibleGroups.value.reduce((sum, group) => sum + group.entries.length, 0))
const summaryType = computed(() => filter.value.type === 'income' ? 'income' : 'expense')
const summaryTypeName = computed(() => summaryType.value === 'income' ? '收入' : '支出')
const summaryEntries = computed(() => entries.value.filter(e => e.type === summaryType.value))
const summaryToday = computed(() => summaryEntries.value.filter(e => e.date === store.today).reduce((sum, e) => sum + e.amountCents, 0))
const summaryCategoryCount = computed(() => new Set(summaryEntries.value.map(e => e.categoryId)).size)
const includesToday = computed(() => (!filter.value.from || filter.value.from <= store.today) && (!filter.value.to || filter.value.to >= store.today))
const selectedMonth = computed(() => {
  const month = filter.value.from.slice(0, 7)
  if (!month || !validDate(month + '-01')) return ''
  const bounds = monthBounds(month)
  return filter.value.from === bounds.from && filter.value.to === bounds.to ? month : ''
})
const monthLabel = computed(() => selectedMonth.value ? `${Number(selectedMonth.value.slice(0, 4))}年${Number(selectedMonth.value.slice(5, 7))}月` : !filter.value.from && !filter.value.to ? '全部日期' : '自定义日期')
const summaryLabel = computed(() => {
  const period = hasDetailFilters.value || !selectedMonth.value ? '筛选范围' : selectedMonth.value === store.today.slice(0, 7) ? '本月' : monthLabel.value
  return `${period}${summaryTypeName.value}`
})
const breakdown = computed(() => {
  // 分类金额和笔数来自同一批筛选结果，点击后与目标账单列表保持一致。
  const map = new Map<string, { sum: number; count: number }>()
  for (const entry of entries.value) if (entry.type === statsType.value) {
    const item = map.get(entry.categoryId) ?? { sum: 0, count: 0 }
    item.sum += entry.amountCents; item.count++; map.set(entry.categoryId, item)
  }
  const total = statsType.value === 'income' ? income.value : expense.value
  return [...map].map(([categoryId, { sum, count }]) => ({ categoryId, sum, count, ratio: total ? sum / total : 0 })).sort((a, b) => b.sum - a.sum)
})
const categoryName = (categoryId: string) => store.data.categories.find(c => c.id === categoryId)?.name ?? '未分类'
function openFilter() { Object.assign(draftFilter, clone(filter.value)); filterError.value = ''; showFilter.value = true }
// 切换收支类型只清除不适用的已选分类；空数组表示不限分类。
function changeFilterType(type: LedgerFilter['type']) {
  draftFilter.type = type
  draftFilter.categoryIds = draftFilter.categoryIds.filter(categoryId => store.data.categories.some(c => c.id === categoryId && (!type || c.type === type)))
}
// 首页快捷切换与弹窗筛选共用口径，保留日期/金额等条件，仅移除类型不适用的分类。
function selectType(type: LedgerFilter['type']) {
  const categoryIds = filter.value.categoryIds.filter(categoryId => store.data.categories.some(c => c.id === categoryId && (!type || c.type === type)))
  filter.value = { ...filter.value, type, categoryIds }; statsType.value = type || 'expense'; trendReturn.value = null
}
// 选择月份切换至自然月，保留分类等其他筛选，清除旧趋势的返回状态。
function changeMonth(event: Event) {
  const month = (event.target as HTMLInputElement).value
  if (!validDate(month + '-01')) return
  filter.value = { ...filter.value, ...monthBounds(month) }; trendReturn.value = null; recentPeriod.value = null; rangeBeforeRecent.value = null
}
// 日期标题使用本地日历，跨年保留年份，补记账单不按创建时间分组。
function dayLabel(date: string) {
  const yesterday = new Date(store.today + 'T12:00:00'); yesterday.setDate(yesterday.getDate() - 1)
  const label = date === store.today ? '今天 · ' : date === localDate(yesterday) ? '昨天 · ' : ''
  const year = date.slice(0, 4) !== store.today.slice(0, 4) ? `${Number(date.slice(0, 4))}年` : ''
  return `${label}${year}${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`
}
function toggleFilterCategory(categoryId: string) {
  draftFilter.categoryIds = draftFilter.categoryIds.includes(categoryId) ? draftFilter.categoryIds.filter(value => value !== categoryId) : [...draftFilter.categoryIds, categoryId]
}
function applyFilter() {
  try { validateFilter(draftFilter); filter.value = clone(draftFilter); trendReturn.value = null; recentPeriod.value = null; rangeBeforeRecent.value = null; statsType.value = filter.value.type || 'expense'; showFilter.value = false }
  catch (error) { filterError.value = errorMessage(error) }
}
function openEntry(entry?: Entry) {
  occurrenceId.value = ''
  editor.value = entry ? clone(entry) : { id: id(), type: 'expense', amountCents: 0, date: localDate(), categoryId: store.data.categories.filter(c => c.type === 'expense').sort((a, b) => a.position - b.position)[0]?.id ?? '', remark: '', createdAt: Date.now(), images: [], deletedAt: 0 }
  amount.value = entry ? amountText(entry.amountCents) : ''; formError.value = ''
}
// 弹窗动画结束后再聚焦，避免键盘弹起与弹窗位移动画同时触发页面滚动。
function focusAmount() { if (editor.value && !submitting.value && !picking.value) amountInput.value?.focus({ preventScroll: true }) }
function changeType(type: Entry['type']) {
  if (!editor.value || editor.value.type === type) return
  editor.value.type = type; editor.value.categoryId = store.data.categories.find(c => c.type === type)?.id ?? ''
}
async function saveEntry(again = false) {
  if (!editor.value || submitting.value || picking.value) return
  submitting.value = true
  try {
    editor.value.amountCents = cents(amount.value)
    if (!validDate(editor.value.date)) throw new Error('请选择有效日期')
    await store.saveEntry(editor.value, occurrenceId.value || undefined)
    const previous = clone(editor.value); editor.value = null; occurrenceId.value = ''; store.notify('账单已保存')
    if (again) { await nextTick(); openEntry(); Object.assign(editor.value!, { type: previous.type, categoryId: previous.categoryId, date: previous.date }); amount.value = '' }
  } catch (error) { formError.value = errorMessage(error) } finally { submitting.value = false }
}
async function removeEntry() {
  if (!editor.value) return
  try { await showConfirmDialog({ title: '移入回收站？', message: '账单及图片保留30天，可在设置中恢复。', confirmButtonText: '移入', cancelButtonText: '保留' }) } catch { return }
  submitting.value = true
  try { await store.deleteEntry(editor.value.id); editor.value = null; store.notify('账单已删除') } catch (error) { formError.value = errorMessage(error) } finally { submitting.value = false }
}
let active = false
const back = (event: Event) => { if (active && (editor.value || showFilter.value)) { event.preventDefault(); if (!submitting.value && !picking.value) { editor.value = null; showFilter.value = false } } }
function copyEntry() { if (!editor.value) return; const original = clone(editor.value); openEntry({ ...original, id: id(), date: localDate(), createdAt: Date.now(), images: [], deletedAt: 0 }) }
function consumeQuery() {
  if (route.path !== '/ledger') return
  const entry = store.data.entries.find(e => e.id === route.query.entry && !e.deletedAt), period = store.pending.find(o => o.id === route.query.period)
  if (entry) openEntry(entry)
  if (period) { openEntry({ id: id(), type: period.type, categoryId: period.categoryId, amountCents: period.amountCents, remark: period.remark, date: localDate(), createdAt: Date.now(), images: [] }); occurrenceId.value = period.id }
  if (typeof route.query.day === 'string') { filter.value = { ...monthFilter(), from: route.query.day, to: route.query.day }; statsType.value = 'expense'; tab.value = 'list'; trendReturn.value = null; recentPeriod.value = null; rangeBeforeRecent.value = null }
  if (Object.keys(route.query).length) void router.replace('/ledger')
}
// 合并分类同步替换所有保留中的筛选，并去重已选分类。
function merged(event: Event) {
  const { sourceId, targetId } = (event as CustomEvent<{ sourceId: string; targetId: string }>).detail
  for (const value of [filter.value, draftFilter, trendReturn.value]) if (value) value.categoryIds = [...new Set(value.categoryIds.map(categoryId => categoryId === sourceId ? targetId : categoryId))]
}
function range(from: string, to: string) { filter.value = { ...filter.value, from, to } }
// 同一快捷范围再次点击时恢复展开前日期；6/12月之间切换保留同一个返回点。
function toggleRecent(count: 6 | 12) {
  if (recentPeriod.value === count && rangeBeforeRecent.value) { range(rangeBeforeRecent.value.from, rangeBeforeRecent.value.to); recentPeriod.value = null; rangeBeforeRecent.value = null; return }
  if (!rangeBeforeRecent.value) rangeBeforeRecent.value = { from: filter.value.from, to: filter.value.to }
  const end = new Date(store.today + 'T12:00:00'), start = new Date(end.getFullYear(), end.getMonth() - count + 1, 1)
  range(localDate(start), monthBounds(store.today.slice(0, 7)).to); recentPeriod.value = count
}
// 月份下钻保留其他筛选，并切换到对应账单明细。
function monthDetails(from: string, to: string) { trendReturn.value = clone(filter.value); range(from, to); tab.value = 'list' }
// 分类下钻只替换分类和对应收支类型，保留日期、金额、关键词及原统计返回点。
function categoryDetails(categoryId: string) {
  if (querying.value || queryError.value) return
  const category = store.data.categories.find(item => item.id === categoryId)
  if (!category || category.type !== statsType.value) return
  trendReturn.value = clone(filter.value)
  filter.value = { ...filter.value, type: statsType.value, categoryIds: [categoryId] }
  tab.value = 'list'
}
// 当前已展开则关闭；从月份或分类明细返回时恢复之前完整的统计筛选。
function showStats() {
  if (tab.value === 'stats') { tab.value = 'list'; return }
  if (trendReturn.value) { filter.value = trendReturn.value; trendReturn.value = null }
  tab.value = 'stats'
}
watch(() => route.query, consumeQuery)
onBeforeRouteLeave(() => { if (picking.value || submitting.value) return false; editor.value = null; showFilter.value = false; return true })
onMounted(() => { window.addEventListener('journal-back', back); window.addEventListener('journal-category-merged', merged) }); onUnmounted(() => { window.removeEventListener('journal-back', back); window.removeEventListener('journal-category-merged', merged) })
onActivated(() => { active = true; consumeQuery() }); onDeactivated(() => { active = false })
</script>

<template>
  <header class="page-header ledger-header">
    <div><h1>我的账单</h1><label class="ledger-month-control"><span>{{ monthLabel }}</span><svg class="ledger-month-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg><input :value="selectedMonth" type="month" min="1900-01" aria-label="选择账单月份" @change="changeMonth"></label></div>
    <button class="icon-button filter-trigger" :class="{ active: hasActiveFilters }" :aria-label="hasActiveFilters ? '筛选账单，已启用筛选' : '筛选账单'" :aria-pressed="hasActiveFilters" :aria-expanded="showFilter" @click="openFilter"><span aria-hidden="true">☷</span><span class="filter-trigger-label">{{ hasActiveFilters ? '已筛选' : '筛选' }}</span></button>
  </header>
  <div v-if="hasDetailFilters" class="chips ledger-filter-chips">
    <span v-for="categoryId in filter.categoryIds" :key="categoryId" class="chip">{{ categoryName(categoryId) }}</span>
    <span v-if="filter.min || filter.max" class="chip">¥ {{ filter.min || '0' }} ～ {{ filter.max || '不限' }}</span><span v-if="filter.keyword" class="chip">{{ filter.keyword }}</span>
  </div>
  <section class="summary expense-summary" :aria-label="summaryLabel" :aria-busy="querying">
    <span class="caption">{{ summaryLabel }}</span><div class="balance">{{ querying ? '…' : queryError ? '—' : `¥${money(summaryType === 'income' ? income : expense)}` }}</div>
    <p v-if="hasDetailFilters || !selectedMonth" class="summary-scope">{{ filter.from || '不限开始' }} 至 {{ filter.to || '不限结束' }} · 按当前筛选汇总</p>
    <div class="pair summary-metrics">
      <div v-if="includesToday"><span class="caption">今日{{ hasDetailFilters ? '筛选' : '' }}{{ summaryTypeName }}</span><p>{{ querying || queryError ? '—' : `¥${money(summaryToday)}` }}</p></div>
      <div v-else><span class="caption">涉及分类</span><p>{{ querying || queryError ? '—' : `${summaryCategoryCount} 个` }}</p></div>
      <div><span class="caption">{{ summaryTypeName }}笔数</span><p>{{ querying || queryError ? '—' : `${summaryEntries.length} 笔` }}</p></div>
    </div>
    <p v-if="filter.type === '' && !querying && !queryError" class="summary-secondary">当前范围收入 ¥{{ money(income) }} · {{ entries.filter(entry => entry.type === 'income').length }} 笔</p>
  </section>
  <button class="recurring-entry" @click="router.push('/recurring')"><span class="recurring-symbol" aria-hidden="true">↻</span><span class="grow">周期账单</span><span v-if="store.pending.length" class="recurring-count">{{ store.pending.length }} 项待确认</span><span v-else class="muted">管理规则</span><span aria-hidden="true">›</span></button>
  <div class="ledger-tools">
    <div class="segmented ledger-type-switch" aria-label="账单类型"><button :class="{ active: filter.type === 'expense' }" :aria-pressed="filter.type === 'expense'" @click="selectType('expense')">支出</button><button :class="{ active: filter.type === '' }" :aria-pressed="filter.type === ''" @click="selectType('')">全部</button><button :class="{ active: filter.type === 'income' }" :aria-pressed="filter.type === 'income'" @click="selectType('income')">收入</button></div>
    <div class="tabs ledger-view-tabs"><button :class="{ active: tab === 'list' }" @click="tab = 'list'">明细</button><button :class="{ active: tab === 'stats' }" @click="showStats">{{ trendReturn ? '返回统计' : '统计' }}</button></div>
  </div>
  <div v-if="queryError" class="panel stack compact-stack" role="alert"><p class="field-error">账单查询失败：{{ queryError }}</p><button class="secondary" @click="refresh">重试查询</button></div>
  <template v-else-if="tab === 'list'">
    <div class="row muted ledger-list-caption"><span>{{ querying ? '正在查询…' : `共 ${entries.length} 笔` }}</span><span>按天查看 · 点击编辑</span></div>
    <div v-if="querying" class="empty" role="status">正在读取账单…</div>
    <template v-else>
      <section v-for="group in visibleGroups" :key="group.date" class="ledger-day-card" :aria-label="dayLabel(group.date)">
        <header class="ledger-day-heading"><h2>{{ dayLabel(group.date) }}</h2><div class="ledger-day-totals"><span v-if="filter.type !== 'income'">支出 ¥{{ money(group.expense) }}</span><span v-if="filter.type !== 'expense'">收入 ¥{{ money(group.income) }}</span></div></header>
        <button v-for="entry in group.entries" :key="entry.id" class="ledger-row ledger-entry" @click="openEntry(entry)"><span class="category-symbol" aria-hidden="true">{{ categoryName(entry.categoryId).slice(0, 1) }}</span><span class="grow"><span class="ledger-entry-title">{{ entry.remark.trim() || categoryName(entry.categoryId) }}</span><span class="ledger-entry-description">{{ entry.remark.trim() ? categoryName(entry.categoryId) : '未填写备注' }}<span v-if="entry.images?.length"> · {{ entry.images.length }} 张图片</span></span></span><span class="number" :class="{ income: entry.type === 'income' }">{{ entry.type === 'income' ? '+' : filter.type === '' ? '−' : '' }}¥{{ money(entry.amountCents) }}</span></button>
      </section>
      <div v-if="!entries.length" class="empty">{{ hasActiveFilters ? '还没有符合条件的账单' : '这个月还没有支出，记下第一笔花费吧。' }}</div>
      <button v-if="entries.length > visibleEntryCount" class="secondary full" @click="limit += 60">加载更多日期</button>
    </template>
  </template>
  <template v-else>
    <section class="panel ledger-category-stats" :aria-busy="querying">
      <div class="row"><h2>{{ statsType === 'expense' ? '钱花在哪' : '收入来源' }}</h2><span class="muted">{{ querying ? '—' : `¥${money(statsType === 'income' ? income : expense)}` }}</span></div>
      <div v-if="!filter.type" class="segmented ledger-stats-switch"><button :class="{ active: statsType === 'expense' }" :aria-pressed="statsType === 'expense'" @click="statsType = 'expense'">支出分类</button><button :class="{ active: statsType === 'income' }" :aria-pressed="statsType === 'income'" @click="statsType = 'income'">收入分类</button></div>
      <p v-if="querying" class="muted">正在汇总…</p>
      <template v-else><button v-for="item in breakdown" :key="item.categoryId" type="button" class="stat-row ledger-category-row" :aria-label="`${categoryName(item.categoryId)}，占比${(item.ratio * 100).toFixed(1)}%，${item.count}笔，总金额${money(item.sum)}元，点击查看${statsType === 'income' ? '收入' : '支出'}账单`" @click="categoryDetails(item.categoryId)"><span class="stat-label"><span class="ledger-category-name">{{ categoryName(item.categoryId) }}</span><span class="category-amount"><span>{{ (item.ratio * 100).toFixed(1) }}%</span><span>· {{ item.count }}笔</span><span>· ¥{{ money(item.sum) }}</span><span class="category-chevron" aria-hidden="true">›</span></span></span><span class="stat-bar" aria-hidden="true"><span :style="{ width: `${item.ratio * 100}%` }"></span></span></button><div v-if="!breakdown.length" class="empty">当前筛选范围内没有{{ statsType === 'income' ? '收入' : '支出' }}</div></template>
      <p class="muted ledger-stats-caption">分类按金额从高到低；点击分类查看对应账单。</p>
    </section>
    <TrendPanel :filter="filter" :recent="recentPeriod" @recent="toggleRecent" @month="monthDetails" />
  </template>
  <div class="floating-action"><button class="primary full" @click="openEntry()">＋ 记一笔</button></div>

  <VanPopup v-model:show="showFilter" position="bottom" round>
    <section class="sheet"><header class="page-header"><h2>筛选账单</h2><button class="icon-button" aria-label="关闭筛选" @click="showFilter = false">×</button></header><div class="stack">
      <div class="pair"><label>开始日期<input v-model="draftFilter.from" type="date" min="1900-01-01"></label><label>结束日期<input v-model="draftFilter.to" type="date" min="1900-01-01"></label></div>
      <div><p class="filter-label">收支类型</p><div class="segmented"><button :class="{ active: draftFilter.type === '' }" :aria-pressed="draftFilter.type === ''" @click="changeFilterType('')">全部</button><button :class="{ active: draftFilter.type === 'expense' }" :aria-pressed="draftFilter.type === 'expense'" @click="changeFilterType('expense')">支出</button><button :class="{ active: draftFilter.type === 'income' }" :aria-pressed="draftFilter.type === 'income'" @click="changeFilterType('income')">收入</button></div></div>
      <div><p class="filter-label">分类（可多选）<span class="muted">{{ draftFilter.categoryIds.length ? ` · 已选${draftFilter.categoryIds.length}个` : ' · 不限分类' }}</span></p><div class="filter-options"><button class="filter-option" :class="{ active: !draftFilter.categoryIds.length }" :aria-pressed="!draftFilter.categoryIds.length" @click="draftFilter.categoryIds = []">全部分类</button><button v-for="category in filterCategories" :key="category.id" class="filter-option" :class="{ active: draftFilter.categoryIds.includes(category.id) }" :aria-pressed="draftFilter.categoryIds.includes(category.id)" @click="toggleFilterCategory(category.id)"><span v-if="draftFilter.categoryIds.includes(category.id)" aria-hidden="true">✓ </span>{{ category.name }}{{ !draftFilter.type ? category.type === 'income' ? '（收入）' : '（支出）' : '' }}</button></div><p class="muted">多个分类匹配任意一个，与日期、金额和备注条件同时满足。</p></div>
      <div><p class="muted">单笔金额（元，包含上下限）</p><div class="pair" style="margin-top:8px"><label>最低金额<input v-model="draftFilter.min" inputmode="decimal" placeholder="不限"></label><label>最高金额<input v-model="draftFilter.max" inputmode="decimal" placeholder="不限"></label></div></div>
      <label>备注关键词<input v-model="draftFilter.keyword" maxlength="500" placeholder="例如：咖啡"></label><p v-if="filterError" class="field-error" role="alert">{{ filterError }}</p>
      <div class="pair"><button class="secondary" @click="Object.assign(draftFilter, monthFilter()); filterError = ''">重置为本月</button><button class="primary" @click="applyFilter">应用筛选</button></div>
    </div></section>
  </VanPopup>
  <VanPopup :show="!!editor" position="bottom" round :close-on-click-overlay="!submitting && !picking" @opened="focusAmount" @update:show="value => { if (!value && !submitting && !picking) editor = null }">
    <section v-if="editor" class="sheet"><header class="page-header"><h2>{{ store.data.entries.some(e => e.id === editor?.id) ? '编辑账单' : '记一笔' }}</h2><button class="icon-button" :disabled="submitting || picking" aria-label="关闭账单编辑" @click="editor = null">×</button></header><form @submit.prevent="saveEntry()"><fieldset class="stack plain-fieldset" :disabled="submitting || picking">
      <div class="segmented"><button type="button" :disabled="submitting" :class="{ active: editor.type === 'expense' }" @click="changeType('expense')">支出</button><button type="button" :disabled="submitting" :class="{ active: editor.type === 'income' }" @click="changeType('income')">收入</button></div>
      <p v-if="occurrenceId" class="muted">原到期日 {{ store.pending.find(o => o.id === occurrenceId)?.dueDate }}；请核对实际发生日期</p>
      <label>金额（元）<input ref="amountInput" v-model="amount" :disabled="submitting || picking" inputmode="decimal" placeholder="0.00" required></label>
      <div v-if="store.data.recent[editor.type].length" class="toolbar"><button v-for="categoryId in store.data.recent[editor.type]" :key="categoryId" type="button" class="chip" @click="editor.categoryId = categoryId">{{ categoryName(categoryId) }}</button></div>
      <div class="pair"><label>分类<select v-model="editor.categoryId" :disabled="submitting" required><option v-if="!categories.length" value="">请先在设置中添加分类</option><option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option></select></label><label>日期<input v-model="editor.date" :disabled="submitting" type="date" min="1900-01-01" required></label></div>
      <label>备注<textarea v-model="editor.remark" :disabled="submitting" maxlength="500" rows="2" placeholder="这笔钱用在了哪里"></textarea></label>
      <AttachmentEditor v-model="editorImages" :max="9" @busy="picking = $event" />
      <p v-if="formError" class="field-error" role="alert">{{ formError }}</p><VanButton native-type="submit" type="primary" block round :loading="submitting">保存账单</VanButton>
      <button type="button" class="secondary full" :disabled="submitting || picking" @click="saveEntry(true)">保存并再记一笔</button>
      <button v-if="store.data.entries.some(e => e.id === editor?.id)" type="button" class="secondary full" :disabled="submitting || picking" @click="copyEntry">复制为新账单（不复制图片）</button>
      <button v-if="store.data.entries.some(e => e.id === editor?.id)" type="button" class="danger" :disabled="submitting" @click="removeEntry">删除这笔账单</button>
    </fieldset></form></section>
  </VanPopup>
</template>

<style scoped>
.ledger-header {
  margin-bottom: 12px;
}
.ledger-header h1 {
  font-size: 23px;
  line-height: 1.25;
}
.ledger-header .filter-trigger {
  min-height: 48px;
  padding: 6px 8px;
  font-size: 18px;
  line-height: 1.1;
}
.ledger-month-control {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  margin-top: 0;
  font-size: 13px;
  line-height: 20px;
  white-space: nowrap;
}
.ledger-month-chevron {
  display: block;
  flex-shrink: 0;
  width: 12px;
  height: 12px;
}
.ledger-month-control input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.ledger-month-control:focus-within {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
  border-radius: 6px;
}
.ledger-filter-chips {
  margin-bottom: 8px;
}
.expense-summary {
  margin-bottom: 0;
  padding: 16px;
  color: var(--ink);
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 16px;
}
.expense-summary .caption {
  color: var(--muted);
  font-size: 12px;
}
.expense-summary .balance {
  margin: 6px 0 10px;
  font-size: clamp(28px, 7.4vw, 36px);
  font-weight: 650;
  letter-spacing: -.025em;
  line-height: 1.25;
  overflow-wrap: anywhere;
}
.summary-scope {
  margin: -2px 0 10px;
  color: var(--muted);
  font-size: 12px;
}
.summary-metrics {
  padding-top: 10px;
  gap: 12px;
  border-top: 1px solid var(--line);
}
.summary-metrics > div + div {
  padding-left: 14px;
  border-left: 1px solid var(--line);
}
.expense-summary .summary-metrics p {
  margin-top: 3px;
  font-size: 18px;
  font-weight: 550;
  overflow-wrap: anywhere;
}
.summary-secondary {
  margin-top: 8px;
  color: var(--muted);
  font-size: 12px;
}
.recurring-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 44px;
  margin: 10px 0 12px;
  padding: 8px 12px;
  text-align: left;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 14px;
  font-size: 14px;
}
.recurring-symbol {
  color: var(--onSoft);
  font-size: 21px;
  line-height: 1;
}
.recurring-count {
  padding: 3px 8px;
  color: var(--onSoft);
  background: var(--soft);
  border-radius: 8px;
  font-size: 12px;
}
.ledger-tools {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 10px;
}
.ledger-type-switch {
  flex: 1;
  gap: 4px;
  min-width: 185px;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--paper);
}
.ledger-type-switch button {
  min-height: 40px;
  padding: 7px 10px;
  border: 0;
  background: transparent;
}
.ledger-type-switch button.active {
  color: var(--onAccent);
  background: var(--accent);
}
.ledger-view-tabs {
  flex-shrink: 0;
  gap: 16px;
  margin-bottom: 0;
  border-bottom: 0;
}
.ledger-view-tabs button {
  min-height: 44px;
  padding: 8px 0;
  white-space: nowrap;
}
.ledger-list-caption {
  font-size: 12px;
}
.ledger-day-card {
  margin-top: 16px;
  padding: 0 15px;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 17px;
}
.ledger-day-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 0;
  border-bottom: 1px solid var(--line);
}
.ledger-day-heading h2 {
  font-size: 14px;
  font-weight: 600;
}
.ledger-day-totals {
  display: grid;
  flex-shrink: 0;
  max-width: 58%;
  color: var(--muted);
  text-align: right;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.ledger-entry {
  gap: 10px;
  padding: 15px 0;
}
.ledger-entry:last-child {
  border-bottom: 0;
}
.ledger-entry-title {
  display: -webkit-box;
  overflow: hidden;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  font-size: 15px;
  font-weight: 500;
}
.ledger-entry-description {
  display: block;
  margin-top: 4px;
  color: var(--muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.ledger-entry .number {
  max-width: 48%;
  white-space: normal;
  text-align: right;
  font-size: 16px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.ledger-category-stats {
  margin-top: 16px;
}
.ledger-category-row {
  display: block;
  width: 100%;
  min-height: 44px;
  padding: 4px 0;
  border-radius: 8px;
  text-align: left;
}
.ledger-category-row > .stat-bar {
  display: block;
}
.ledger-category-row:active {
  background: var(--soft);
}
.ledger-category-row:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 4px;
}
.ledger-category-row .stat-label {
  align-items: flex-start;
  gap: 8px;
}
.ledger-category-name {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.category-amount {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  max-width: 78%;
  gap: 6px;
  font-variant-numeric: tabular-nums;
}
.category-amount > span {
  white-space: nowrap;
}
.category-chevron {
  color: var(--muted);
  font-size: 18px;
  line-height: 1;
}
.ledger-stats-switch {
  margin-top: 14px;
}
.ledger-stats-caption {
  margin-top: 18px;
}
</style>
