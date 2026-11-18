<script setup lang="ts">
import { computed } from 'vue'
import { filterEntries, localDate, money, monthBounds, type LedgerFilter } from '../domain'
import { useJournal } from '../stores/journal'
const props = defineProps<{ filter: LedgerFilter; recent: 6 | 12 | null }>(), emit = defineEmits<{ recent: [6 | 12]; month: [string, string] }>(), store = useJournal()
const rows = computed(() => {
  const data = filterEntries(store.data.entries, props.filter), months = new Set(data.map(e => e.date.slice(0, 7)))
  if (props.filter.from && props.filter.to) {
    const date = new Date(props.filter.from.slice(0, 7) + '-01T12:00:00'), end = props.filter.to.slice(0, 7)
    while (localDate(date).slice(0, 7) <= end) { months.add(localDate(date).slice(0, 7)); date.setMonth(date.getMonth() + 1) }
  }
  return [...months].sort().map(month => {
    const values = data.filter(e => e.date.startsWith(month) && (month !== store.today.slice(0, 7) || e.date <= store.today)), sum = (type: 'income' | 'expense') => values.filter(e => e.type === type).reduce((a, e) => a + e.amountCents, 0)
    return { month, income: sum('income'), expense: sum('expense') }
  })
})
const max = computed(() => Math.max(1, ...rows.value.map(row => props.filter.type === 'income' ? row.income : row.expense)))
const comparison = computed(() => {
  const month = props.filter.from.slice(0, 7)
  if (!month || month !== props.filter.to.slice(0, 7)) return null
  const bounds = monthBounds(month), isCurrent = month === store.today.slice(0, 7)
  if (props.filter.from !== bounds.from || props.filter.to !== bounds.to && (!isCurrent || props.filter.to !== store.today) || month > store.today.slice(0, 7)) return null
  const date = new Date(bounds.from + 'T12:00:00'); date.setMonth(date.getMonth() - 1)
  const previous = monthBounds(localDate(date).slice(0, 7)), from = previous.from, to = isCurrent ? `${from.slice(0, 7)}-${String(Math.min(Number(store.today.slice(8)), Number(previous.to.slice(8)))).padStart(2, '0')}` : previous.to
  const sum = (start: string, end: string, type: 'income' | 'expense') => filterEntries(store.data.entries, { ...props.filter, from: start, to: end }).filter(e => e.type === type).reduce((a, e) => a + e.amountCents, 0)
  const types: ('expense' | 'income')[] = props.filter.type ? [props.filter.type] : ['expense', 'income']
  return { from, to, values: types.map(type => { const before = sum(from, to, type), current = sum(bounds.from, isCurrent ? store.today : bounds.to, type); return { type, before, change: before ? (current - before) / before * 100 : null } }) }
})
// 下钻日期取本月与原范围的交集，保证明细和刚看到的趋势金额一致。
function details(month: string) {
  const bounds = monthBounds(month)
  const from = props.filter.from && props.filter.from > bounds.from ? props.filter.from : bounds.from
  let to = props.filter.to && props.filter.to < bounds.to ? props.filter.to : bounds.to
  if (month === store.today.slice(0, 7) && to > store.today) to = store.today
  if (from <= to) emit('month', from, to)
}
</script>
<template>
  <section class="panel stack compact-stack"><h2>{{ filter.type === 'income' ? '收入趋势' : filter.type === 'expense' ? '支出趋势' : '月度收支趋势' }}</h2><div class="toolbar"><button class="filter-option" :class="{ active: recent === 6 }" :aria-pressed="recent === 6" :aria-expanded="recent === 6" @click="emit('recent', 6)">近6个月</button><button class="filter-option" :class="{ active: recent === 12 }" :aria-pressed="recent === 12" :aria-expanded="recent === 12" @click="emit('recent', 12)">近12个月</button></div><p class="muted">跟随当前筛选；本月截至今天。再点已选范围可收起，点击月份查看明细。</p>
    <button v-for="row in rows" :key="row.month" class="trend-row" @click="details(row.month)"><span>{{ row.month }}</span><span v-if="filter.type !== 'income'" class="trend-primary">支出 ¥{{ money(row.expense) }}</span><span v-if="filter.type !== 'expense'" :class="{ 'trend-primary': filter.type === 'income' }">收入 ¥{{ money(row.income) }}</span><div class="stat-bar"><span :style="{ width: `${(filter.type === 'income' ? row.income : row.expense) / max * 100}%` }"></span></div></button>
    <div v-if="comparison"><p class="muted">上期：{{ comparison.from }} 至 {{ comparison.to }}</p><p v-for="item in comparison.values" :key="item.type">{{ item.type === 'income' ? '收入' : '支出' }}：{{ item.change === null ? '上期无金额' : `${item.change >= 0 ? '+' : ''}${item.change.toFixed(1)}%` }}</p></div>
  </section>
</template>

<style scoped>
.trend-row > .trend-primary {
  margin-top: 5px;
  font-size: 16px;
  font-weight: 600;
}
</style>
