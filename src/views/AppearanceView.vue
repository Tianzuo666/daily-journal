<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import { useJournal, clone, errorMessage } from '../stores/journal'
import { defaultAppearance, type Appearance, type ThemePreset } from '../domain'
import { validateAppearance } from '../backup-format'
import { applyTheme, presets } from '../theme'

const store = useJournal(), router = useRouter(), draft = ref(clone(store.data.appearance)), error = ref('')
const accentHex = ref(draft.value.accent), backgroundHex = ref(draft.value.background)
const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches
function preview() { validateAppearance(draft.value); applyTheme(draft.value, systemDark()); accentHex.value = draft.value.accent; backgroundHex.value = draft.value.background }
async function save() {
  try { validateAppearance(draft.value); await store.saveAppearance(draft.value); error.value = ''; return true }
  catch (reason) { error.value = errorMessage(reason); return false }
}
async function preset(key: ThemePreset) {
  if (key === 'custom' && draft.value.preset !== 'custom') { const current = presets[draft.value.preset as keyof typeof presets]; draft.value.accent = current.light; draft.value.background = current.background }
  draft.value.preset = key; preview(); await save()
}
async function mode(value: Appearance['mode']) { draft.value.mode = value; preview(); await save() }
async function reset() { draft.value = defaultAppearance(); preview(); await save() }
async function hex(field: 'accent' | 'background') {
  const value = (field === 'accent' ? accentHex.value : backgroundHex.value).trim()
  if (!/^#[0-9a-f]{6}$/i.test(value)) { error.value = '请输入 # 加六位十六进制颜色，例如 #315d94'; return }
  draft.value[field] = value.toLowerCase(); preview(); await save()
}
onBeforeRouteLeave(async () => JSON.stringify(draft.value) === JSON.stringify(store.data.appearance) || await save())
onUnmounted(() => applyTheme(store.data.appearance, systemDark()))
</script>

<template>
  <header class="page-header"><div><h1>外观配色</h1><p class="muted">切换后立即应用</p></div><button class="icon-button" aria-label="返回设置" @click="router.push('/settings')">‹</button></header>
  <div class="section-label">显示模式</div><div class="segmented"><button v-for="item in ([['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']] as const)" :key="item[0]" :class="{ active: draft.mode === item[0] }" :aria-pressed="draft.mode === item[0]" @click="mode(item[0])">{{ item[1] }}</button></div>
  <div class="section-label">预设配色</div><div class="palette-grid"><button v-for="(value, key) in presets" :key="key" class="palette" :class="{ active: draft.preset === key }" :aria-pressed="draft.preset === key" @click="preset(key)"><span class="swatches"><span :style="{ background: value.light }"></span><span :style="{ background: value.dark }"></span><span :style="{ background: value.background }"></span></span>{{ value.name }}</button></div>
  <button class="secondary full" style="margin-top:14px" @click="preset('custom')">自定义配色</button>
  <div v-if="draft.preset === 'custom'" class="stack" style="margin-top:20px"><label>主题色<div class="color-field"><input v-model="draft.accent" type="color" aria-label="选择主题色" @input="preview" @change="save"><input v-model="accentHex" type="text" maxlength="7" spellcheck="false" aria-label="主题色十六进制值" @change="hex('accent')"></div></label><label>页面底色<div class="color-field"><input v-model="draft.background" type="color" aria-label="选择页面底色" @input="preview" @change="save"><input v-model="backgroundHex" type="text" maxlength="7" spellcheck="false" aria-label="底色十六进制值" @change="hex('background')"></div></label><p class="muted">深色模式保留底色倾向并降低亮度，文字自动适配。</p></div>
  <p v-if="error" class="field-error" role="alert" style="margin-top:20px">{{ error }}</p><div class="theme-preview"><h2>当前配色</h2><p class="muted">应用于记账、记录与设置</p><button class="primary" @click="store.notify('当前配色已应用')">按钮效果</button></div>
  <button class="secondary full" style="margin-top:18px" @click="reset">恢复默认配色</button>
</template>
