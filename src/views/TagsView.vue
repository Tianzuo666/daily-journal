<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog } from 'vant'
import { useJournal, errorMessage } from '../stores/journal'

const store = useJournal(), router = useRouter(), name = ref(''), tagId = ref(''), error = ref(''), working = ref(false)
async function save() { if (working.value) return; working.value = true; try { await store.saveTag(name.value, tagId.value || undefined); name.value = ''; tagId.value = ''; error.value = '' } catch (reason) { error.value = errorMessage(reason) } finally { working.value = false } }
async function remove(id: string) { try { await showConfirmDialog({ title: '删除这个标签？', message: '只移除标签关联，记录不会被删除。' }); await store.deleteTag(id) } catch (reason) { if (reason instanceof Error) error.value = reason.message } }
</script>

<template><header class="page-header"><h1>记录标签</h1><button class="icon-button" @click="router.push('/settings')">‹</button></header><form class="stack" @submit.prevent="save"><label>{{ tagId ? '修改标签' : '新标签' }}<input v-model="name" maxlength="20" required></label><div class="toolbar"><button class="primary" :disabled="working">保存</button><button v-if="tagId" type="button" class="secondary" @click="tagId = ''; name = ''">取消修改</button></div><p v-if="error" class="field-error">{{ error }}</p></form><div v-for="tag in store.data.tags" :key="tag.id" class="category-row"><span>{{ tag.name }}</span><button class="secondary" @click="tagId = tag.id; name = tag.name">改名</button><button class="danger" @click="remove(tag.id)">删除</button></div></template>
