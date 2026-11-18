<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog } from 'vant'
import { useJournal, errorMessage } from '../stores/journal'
import { native, files, type BackupFile } from '../native'
import { presets } from '../theme'
import { allImages } from '../domain'
import { version as appVersion } from '../../package.json'

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
      const incoming = manifest.data, count = (data: typeof incoming) => `有效账单 ${data.entries.filter(e => !e.deletedAt).length} 笔、记录 ${data.notes.filter(n => !n.deletedAt).length} 篇、图片 ${allImages(data).length} 张；回收站 ${[...data.entries, ...data.notes].filter(i => i.deletedAt).length} 项；周期规则 ${data.rules.filter(r => !r.deleted).length} 条`
      try { await showConfirmDialog({ title: '整体恢复覆盖当前数据？', message: `备份时间：${new Date(manifest.createdAt).toLocaleString('zh-CN')}\n备份格式：v${manifest.version}\n备份：${count(incoming)}\n当前：${count(store.data)}\n\n先自动备份当前数据，成功后才整体覆盖。密码锁及本机文件夹授权不随备份恢复。`, confirmButtonText: '备份当前并恢复', cancelButtonText: '取消' }) }
      catch { return }
      await store.restore(stage)
    } finally { try { await files.discardStage({ token: stage.token }) } catch { /* 启动时清理遗留临时文件。 */ } }
  })
}
const size = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
const exportBackup = (file: BackupFile) => action(() => store.exportBackup(file))
async function removeBackup(file: BackupFile) { try { await showConfirmDialog({ title: '删除这份本机备份？', message: file.name + '\n不会删除你已另存到应用外的文件。' }) } catch { return }; await action(() => store.deleteBackup(file)) }
const stamp = (value: unknown) => typeof value === 'number' && value > 0 ? new Date(value).toLocaleString('zh-CN') : '尚无记录'
onMounted(() => { if (native) void action(store.refreshFiles) })
</script>

<template>
  <header class="page-header"><div><h1>设置</h1><p class="muted">所有内容保存在这台设备上</p></div></header>
  <div class="section-label">偏好设置</div>
  <button class="setting-row" @click="router.push('/privacy')"><span class="grow">隐私与密码锁<p class="muted">可选六位密码 · 默认关闭</p></span><span>›</span></button>
  <button class="setting-row" @click="router.push('/tags')"><span class="grow">记录标签<p class="muted">新增、改名与移除标签</p></span><span>›</span></button>
  <button class="setting-row" @click="router.push('/appearance')"><span class="setting-symbol" aria-hidden="true">◐</span><span class="grow"><span>外观配色</span><p class="muted">{{ store.data.appearance.preset === 'custom' ? '自定义配色' : presets[store.data.appearance.preset].name }}</p></span><span>›</span></button>
  <button class="setting-row" @click="router.push('/categories')"><span class="setting-symbol" aria-hidden="true">▦</span><span class="grow"><span>记账分类</span><p class="muted">新增、修改和管理分类</p></span><span>›</span></button>
  <div class="section-label">数据管理</div>
  <button class="setting-row" @click="router.push('/trash')"><span class="grow">回收站<p class="muted">{{ [...store.data.entries, ...store.data.notes].filter(i => i.deletedAt).length }} 项 · 保留30天</p></span><span>›</span></button>
  <section class="panel stack compact-stack"><p class="muted">最近生成本机完整备份：{{ stamp(store.device.backupAt) }}</p><p class="muted">最近成功另存到应用外：{{ stamp(store.device.exportedAt) }}</p><p class="muted">该文件包含的数据时间：{{ stamp(store.device.exportedDataAt) }}</p><label class="inline-check"><input type="checkbox" :checked="store.device.reminders !== false" @change="action(() => store.updateDevice({ reminders: ($event.target as HTMLInputElement).checked }))">7天未另存备份时，在应用内提醒</label><p class="muted">另存文件未加密，可能包含个人内容；卸载会删除应用内数据。</p></section>
  <button class="setting-row" :disabled="store.busy" @click="backup"><span class="setting-symbol" aria-hidden="true">▣</span><span class="grow"><span>完整备份</span><p class="muted">账单、记录、图片、置顶排序和配色</p></span><span>›</span></button>
  <button class="setting-row" :disabled="store.busy" @click="restore"><span class="setting-symbol" aria-hidden="true">↙</span><span class="grow"><span>从备份恢复</span><p class="muted">选择 ZIP 备份，覆盖前自动备份当前数据</p></span><span>›</span></button>
  <button class="setting-row" :disabled="store.busy" @click="action(store.exportLedger)"><span class="setting-symbol" aria-hidden="true">▤</span><span class="grow"><span>导出账单 CSV</span><p class="muted">在表格工具中查看全部账单</p></span><span>›</span></button>
  <button class="setting-row" :disabled="store.busy" @click="action(store.exportNotes)"><span class="setting-symbol" aria-hidden="true">▧</span><span class="grow"><span>导出记录与图片</span><p class="muted">ZIP 内含文字、图片和待办状态</p></span><span>›</span></button>
  <div class="section-label">本机内容</div><p>{{ store.data.entries.filter(e => !e.deletedAt).length }} 笔账单 · {{ store.data.notes.filter(n => !n.deletedAt).length }} 篇记录</p><p class="muted" style="margin-top:8px">卸载应用会删除应用内数据；请将完整备份另存到应用外。</p>
  <div class="section-label">本机备份 · {{ store.backups.length }} 份</div>
  <p v-if="!store.backups.length" class="muted">还没有备份</p>
  <div v-for="file in store.backups" :key="file.path" class="backup-row"><div class="grow"><p>{{ file.name }}</p><p class="muted">{{ new Date(file.createdAt).toLocaleString('zh-CN') }} · {{ size(file.size) }}</p></div><button class="secondary" :disabled="store.busy" @click="exportBackup(file)">另存</button><button class="danger" :disabled="store.busy" @click="removeBackup(file)">删除</button></div>
  <p class="muted" style="margin-top:25px">日常记 · {{ appVersion }}</p>
</template>
