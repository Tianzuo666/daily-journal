import { defineStore } from 'pinia'
import { ref } from 'vue'
import { lock, native, type LockStatus } from '../native'

export const useSecurity = defineStore('security', () => {
  const state = ref<LockStatus>({ enabled: false, locked: false, secure: false, retryAfter: 0 }), loaded = ref(!native), error = ref(''), working = ref(false), checking = ref(false)
  async function refresh() {
    if (!native) return
    try { state.value = await lock.status(); loaded.value = true; error.value = '' }
    catch { error.value = '无法读取本机密码锁状态，请重试'; loaded.value = false }
    finally { checking.value = false }
  }
  // 凭据只发往本机原生插件，不写入内容数据库、浏览器存储或备份。
  async function act(kind: 'unlock' | 'configure' | 'reset', pin: string, currentPin = '', disable = false) {
    if (!native || working.value) return
    working.value = true
    try {
      state.value = kind === 'unlock' ? await lock.unlock({ pin }) : kind === 'reset' ? await lock.reset({ pin }) : await lock.configure({ pin, currentPin, disable })
    } finally { working.value = false }
  }
  return { state, loaded, error, working, checking, refresh, act }
})
