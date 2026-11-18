<script setup lang="ts">
import { ref } from 'vue'
import { useSecurity } from '../stores/security'
import { errorMessage } from '../stores/journal'
import { native } from '../native'

const props = defineProps<{ locked?: boolean }>(), security = useSecurity()
const mode = ref<'unlock' | 'configure' | 'disable' | 'reset'>('unlock'), pin = ref(''), repeat = ref(''), current = ref(''), error = ref('')
function choose(value: typeof mode.value) { mode.value = value; pin.value = ''; repeat.value = ''; current.value = ''; error.value = '' }
async function submit() {
  if (security.working) return
  error.value = ''
  try {
    const action = props.locked && mode.value !== 'reset' ? 'unlock' : mode.value === 'reset' ? 'reset' : 'configure'
    if (mode.value !== 'disable' && (!/^\d{6}$/.test(pin.value) || (action !== 'unlock' && pin.value !== repeat.value))) throw new Error('请输入相同的六位数字密码')
    await security.act(action, pin.value, current.value, mode.value === 'disable')
    choose('unlock')
  } catch (reason) { error.value = errorMessage(reason); await security.refresh() }
}
</script>

<template>
  <section class="stack">
    <h2>{{ props.locked ? '解锁日常记' : '应用密码锁' }}</h2>
    <p class="muted">{{ security.state.enabled ? '六位应用密码 · 后台30秒锁定 · 最近任务隐藏内容' : '当前未启用，打开应用无需密码' }}</p>
    <p v-if="!native" class="muted">密码锁仅在安卓使用，浏览器预览不会保存密码。</p>
    <template v-else-if="!props.locked && mode === 'unlock'">
      <button class="primary" @click="choose('configure')">{{ security.state.enabled ? '修改密码' : '启用密码锁' }}</button>
      <button v-if="security.state.enabled" class="secondary" @click="choose('disable')">停用密码锁</button>
      <p v-if="!security.state.secure" class="muted">启用前请先设置手机系统锁屏密码，以便忘记应用密码时重设。</p>
    </template>
    <form v-else class="stack" @submit.prevent="submit">
      <label v-if="!props.locked && security.state.enabled && mode !== 'reset'">当前应用密码<input v-model="current" type="password" inputmode="numeric" maxlength="6" autocomplete="off"></label>
      <label v-if="mode !== 'disable'">{{ mode === 'reset' || !props.locked ? '新六位密码' : '六位应用密码' }}<input v-model="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="off" autofocus></label>
      <label v-if="mode !== 'disable' && (mode === 'reset' || !props.locked)">再次输入新密码<input v-model="repeat" type="password" inputmode="numeric" maxlength="6" autocomplete="off"></label>
      <p v-if="mode === 'reset'" class="muted">提交后由手机系统验证锁屏凭据；取消验证不会更改密码。</p>
      <button class="primary" :disabled="security.working">{{ security.working ? '正在验证…' : mode === 'reset' ? '系统验证并重设' : mode === 'disable' ? '验证并停用' : props.locked ? '解锁' : '保存密码' }}</button>
      <button v-if="mode !== 'unlock'" type="button" class="secondary" :disabled="security.working" @click="choose('unlock')">取消</button>
    </form>
    <button v-if="native && security.state.enabled && mode !== 'reset'" class="secondary" :disabled="security.working" @click="choose('reset')">忘记密码 · 用系统锁屏凭据重设</button>
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    <p class="muted">应用锁控制访问；数据库、图片和导出的备份文件没有内容加密。</p>
  </section>
</template>
