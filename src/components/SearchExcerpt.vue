<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ text: string; keyword: string }>()
// 通过文本节点标亮，不把搜索词或记录内容作为 HTML 注入。
const pieces = computed(() => { const q = props.keyword.trim().toLocaleLowerCase(), text = props.text; if (!q) return [{ text, match: false }]; const result: { text: string; match: boolean }[] = []; let start = 0, index: number; while ((index = text.toLocaleLowerCase().indexOf(q, start)) !== -1) { result.push({ text: text.slice(start, index), match: false }, { text: text.slice(index, index + q.length), match: true }); start = index + q.length } result.push({ text: text.slice(start), match: false }); return result })
</script>
<template><template v-for="(piece, index) in pieces" :key="index"><mark v-if="piece.match">{{ piece.text }}</mark><span v-else>{{ piece.text }}</span></template></template>
