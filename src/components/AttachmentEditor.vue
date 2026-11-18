<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { allImages, type Attachment } from '../domain'
import { files, imageUrl, native } from '../native'
import { useJournal, errorMessage } from '../stores/journal'

const props = defineProps<{ modelValue: Attachment[]; max?: number }>()
const emit = defineEmits<{ 'update:modelValue': [Attachment[]]; busy: [boolean] }>()
const store = useJournal(), picking = ref(false), selected = ref(-1)
const importedNames = new Set<string>()
onUnmounted(() => { const used = new Set(allImages(store.data).map(i => i.file)), unused = [...importedNames].filter(name => !used.has(name)); if (native && unused.length) void files.removeImages({ images: unused }).catch(() => undefined) })
async function pick() {
  if (!native) { store.notify('添加图片需要在安卓版本中使用'); return }
  picking.value = true; emit('busy', true)
  try {
    const result = await files.pickImages(), imported = result.images ?? []; imported.forEach(i => importedNames.add(i.file))
    if (props.max && props.modelValue.length + imported.length > props.max) { await files.removeImages({ images: imported.map(i => i.file) }); throw new Error(`每笔账单最多${props.max}张图片`) }
    if (imported.length) emit('update:modelValue', [...props.modelValue, ...imported])
  } catch (reason) { store.notify(errorMessage(reason)) } finally { picking.value = false; emit('busy', false) }
}
function move(index: number, offset: number) { const images = [...props.modelValue], target = index + offset; if (target < 0 || target >= images.length) return; [images[index], images[target]] = [images[target], images[index]]; emit('update:modelValue', images) }
</script>
<template>
  <div class="attachments"><div v-for="(image, index) in modelValue" :key="image.file" class="attachment">
    <img :src="imageUrl(store.imageDirectory, image.file)" :alt="image.name" loading="lazy" @click="selected = index">
    <button type="button" :aria-label="`移除图片${index + 1}`" @click="emit('update:modelValue', modelValue.filter((_, i) => i !== index))">×</button>
    <div class="row"><button type="button" :disabled="index === 0" @click="move(index, -1)">前移</button><button type="button" :disabled="index === modelValue.length - 1" @click="move(index, 1)">后移</button></div>
  </div></div>
  <button type="button" class="secondary" :disabled="picking" @click="pick">{{ picking ? '正在添加…' : `＋ 图片${max ? `（最多${max}张）` : ''}` }}</button>
  <div v-if="selected >= 0 && modelValue[selected]" class="photo-viewer" role="dialog" aria-label="账单图片预览" @click.self="selected = -1">
    <img :src="imageUrl(store.imageDirectory, modelValue[selected].file)" :alt="modelValue[selected].name">
    <button type="button" aria-label="关闭图片预览" @click="selected = -1">×</button>
    <div class="photo-navigation"><button type="button" :disabled="selected === 0" @click="selected--">上一张</button><span>{{ selected + 1 }}/{{ modelValue.length }}</span><button type="button" :disabled="selected === modelValue.length - 1" @click="selected++">下一张</button></div>
  </div>
</template>
