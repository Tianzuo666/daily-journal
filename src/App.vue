<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { App as CapacitorApp } from '@capacitor/app'
import { showConfirmDialog } from 'vant'
import { useJournal, errorMessage } from './stores/journal'
import { native, files } from './native'
import { applyTheme } from './theme'
import { useSecurity } from './stores/security'
import PasswordPanel from './components/PasswordPanel.vue'

const store = useJournal(), route = useRoute(), router = useRouter()
const security = useSecurity()
const visible = computed(() => security.loaded && !security.state.locked && !security.checking)
const reminderVisible = ref(false)
// 展示时即记录当天已提醒，保留当前横幅直到用户操作，重开应用不再重复提醒。
watch([() => store.ready, visible, () => store.backupDue], ([ready, unlocked, due]) => {
  if (!unlocked || store.device.reminders === false) { reminderVisible.value = false; return }
  if (ready && due && !reminderVisible.value) { reminderVisible.value = true; void store.updateDevice({ dismissedDay: store.today }).catch(handleError) }
})
const media = window.matchMedia('(prefers-color-scheme: dark)'), systemDark = ref(media.matches)
const onTheme = (event: MediaQueryListEvent) => { systemDark.value = event.matches }
const active = computed(() => route.path.startsWith('/notes') ? 'notes' : ['/settings', '/appearance', '/categories', '/privacy', '/trash', '/tags'].includes(route.path) ? 'settings' : 'ledger')
let heartbeat: ReturnType<typeof setInterval> | undefined
const refreshForeground = () => { if (!document.hidden) { security.checking = native; void security.refresh(); if (store.ready) void store.maintenance().catch(handleError) } }
let removeBack: (() => Promise<void>) | undefined
watch([() => store.data.appearance, systemDark], ([appearance, dark]) => {
  const bars = applyTheme(appearance, dark)
  if (native) void files.setSystemBars(bars).catch(() => undefined)
}, { deep: true, immediate: true })
onMounted(async () => {
  media.addEventListener('change', onTheme)
  document.addEventListener('visibilitychange', refreshForeground)
  await security.refresh()
  await store.boot()
  heartbeat = setInterval(() => { if (!document.hidden) { void security.refresh(); if (store.ready) void store.maintenance().catch(handleError) } }, 30_000)
  if (native) {
    const listener = await CapacitorApp.addListener('backButton', async () => {
      if (store.busy || !visible.value) return
      const event = new Event('journal-back', { cancelable: true })
      if (!window.dispatchEvent(event)) return
      if (route.path.startsWith('/notes/')) { await router.push('/notes'); return }
      if (['/appearance', '/categories', '/privacy', '/trash', '/tags'].includes(route.path)) { await router.push('/settings'); return }
      if (route.path === '/recurring') { await router.push('/ledger'); return }
      try { await showConfirmDialog({ title: '退出日常记？', message: '已保存的内容保留在本机。', confirmButtonText: '退出', cancelButtonText: '继续使用' }); await CapacitorApp.exitApp() } catch { /* 取消退出。 */ }
    })
    removeBack = () => listener.remove()
  }
})
onUnmounted(() => { media.removeEventListener('change', onTheme); document.removeEventListener('visibilitychange', refreshForeground); clearInterval(heartbeat); void removeBack?.() })
function handleError(error: unknown) { store.notify(errorMessage(error)) }
</script>

<template>
  <div class="app-shell">
    <div v-if="reminderVisible && visible" class="backup-reminder"><span>有内容尚未另存到应用外，请备份以免卸载后丢失。</span><button @click="reminderVisible = false; router.push('/settings')">去备份</button><button @click="reminderVisible = false">知道了</button></div>
    <div v-if="!native" class="preview-banner">浏览器仅预览界面，修改在刷新后丢失；正式数据保存在安卓本机。</div>
    <main v-if="store.ready" v-show="visible"><RouterView v-slot="{ Component }"><KeepAlive include="LedgerView,NotesView"><component :is="Component" /></KeepAlive></RouterView></main>
    <div v-if="!security.loaded" class="lock-screen"><p>{{ security.error || '正在读取密码锁…' }}</p><button class="secondary" @click="security.refresh()">重试</button></div>
    <div v-else-if="security.state.locked" class="lock-screen"><PasswordPanel locked /></div>
    <div v-else-if="!store.ready" class="startup">
      <h1>日常记</h1><p>{{ store.bootError || '正在打开本地数据…' }}</p>
      <button v-if="store.bootError" class="secondary" @click="store.boot().catch(handleError)">重试</button>
    </div>
    <nav v-if="store.ready && visible && !route.path.startsWith('/notes/')" class="bottom-nav" aria-label="主导航">
      <RouterLink to="/ledger" :class="{ selected: active === 'ledger' }"><span aria-hidden="true">▤</span>记账</RouterLink>
      <RouterLink to="/notes" :class="{ selected: active === 'notes' }"><span aria-hidden="true">▧</span>记录</RouterLink>
      <RouterLink to="/settings" :class="{ selected: active === 'settings' }"><span aria-hidden="true">⚙</span>设置</RouterLink>
    </nav>
    <div v-if="store.message" class="toast" role="status" aria-live="polite">{{ store.message }}</div>
    <div v-if="store.busy" class="busy-mask" role="status" aria-live="polite"><div class="busy-content">{{ store.processing }}</div></div>
  </div>
</template>
