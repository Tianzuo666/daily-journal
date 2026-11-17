<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog } from 'vant'
import { useJournal, errorMessage } from '../stores/journal'
import { native, files, type BackupFile } from '../native'
import { presets } from '../theme'

const store = useJournal(), router = useRouter()
async function action(job: () => Promise<unknown>) { try { await job() } catch (error) { store.notify(errorMessage(error)) } }
async function backup() {
  await action(async () => {
    const file = await store.backup(); store.notify('完整备份已生成，接下来选择保存到应用外的位置')
    await store.exportBackup(file)
  })
}
async function restore() {
  await action(async () => {
    const selected = await store.chooseBackup()
    if (!selected) return
    const { manifest, stage } = selected
    try {
      try { await showConfirmDialog({ title: '整体恢复覆盖当前数据？', message: `备份时间：${new Date(manifest.createdAt).toLocaleString('zh-CN')}\n账单 ${manifest.data.entries.length} 笔 · 记录 ${manifest.data.notes.length} 篇\n\n先自动备份当前数据，成功后才覆盖。置顶、排序和配色一并恢复。`, confirmButtonText: '备份当前并恢复', cancelButtonText: '取消' }) }
      catch { return }
      await store.restore(stage)
    } finally { try { await files.discardStage({ token: stage.token }) } catch { /* 启动时清理遗留临时文件。 */ } }
  })
}
const size = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
const exportBackup = (file: BackupFile) => action(() => store.exportBackup(file))
onMounted(() => { if (native) void action(store.refreshFiles) })
</script>

<template>
  <header class="page-header"><div><h1>设置</h1><p class="muted">所有内容保存在这台设备上</p></div></header>
  <div class="section-label">偏好设置</div>
  <button class="setting-row" @click="router.push('/appearance')"><span class="setting-symbol" aria-hidden="true">◐</span><span class="grow"><span>外观配色</span><p class="muted">{{ store.data.appearance.preset === 'custom' ? '自定义配色' : presets[store.data.appearance.preset].name }}</p></span><span>›</span></button>
  <button class="setting-row" @click="router.push('/categories')"><span class="setting-symbol" aria-hidden="true">▦</span><span class="grow"><span>记账分类</span><p class="muted">新增、修改和管理分类</p></span><span>›</span></button>
  <div class="section-label">数据管理</div>
  <button class="setting-row" :disabled="store.busy" @click="backup"><span class="setting-symbol" aria-hidden="true">▣</span><span class="grow"><span>完整备份</span><p class="muted">账单、记录、图片、置顶排序和配色</p></span><span>›</span></button>
  <button class="setting-row" :disabled="store.busy" @click="restore"><span class="setting-symbol" aria-hidden="true">↙</span><span class="grow"><span>从备份恢复</span><p class="muted">选择 ZIP 备份，覆盖前自动备份当前数据</p></span><span>›</span></button>
  <button class="setting-row" :disabled="store.busy" @click="action(store.exportLedger)"><span class="setting-symbol" aria-hidden="true">▤</span><span class="grow"><span>导出账单 CSV</span><p class="muted">在表格工具中查看全部账单</p></span><span>›</span></button>
  <button class="setting-row" :disabled="store.busy" @click="action(store.exportNotes)"><span class="setting-symbol" aria-hidden="true">▧</span><span class="grow"><span>导出记录与图片</span><p class="muted">ZIP 内含文字、图片和待办状态</p></span><span>›</span></button>
  <div class="section-label">本机内容</div><p>{{ store.data.entries.length }} 笔账单 · {{ store.data.notes.length }} 篇记录</p><p class="muted" style="margin-top:8px">卸载应用会删除应用内数据；请将完整备份另存到应用外。</p>
  <div class="section-label">本机备份 · {{ store.backups.length }} 份</div>
  <p v-if="!store.backups.length" class="muted">还没有备份</p>
  <div v-for="file in store.backups" :key="file.path" class="backup-row"><div class="grow"><p>{{ file.name }}</p><p class="muted">{{ new Date(file.createdAt).toLocaleString('zh-CN') }} · {{ size(file.size) }}</p></div><button class="secondary" :disabled="store.busy" @click="exportBackup(file)">另存</button></div>
  <p class="muted" style="margin-top:25px">日常记 · 0.1.0</p>
</template>
