<script setup lang="ts">
import { useRouter } from 'vue-router'
import PasswordPanel from '../components/PasswordPanel.vue'
const router = useRouter()
</script>
<template><header class="page-header"><h1>隐私与密码锁</h1><button class="icon-button" aria-label="返回设置" @click="router.push('/settings')">‹</button></header><PasswordPanel /></template>
