import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import LedgerView from './views/LedgerView.vue'
import NotesView from './views/NotesView.vue'
import RecordView from './views/RecordView.vue'
import SettingsView from './views/SettingsView.vue'
import AppearanceView from './views/AppearanceView.vue'
import CategoriesView from './views/CategoriesView.vue'
import './style.css'
import 'vant/lib/button/style'
import 'vant/lib/popup/style'
import 'vant/lib/dialog/style'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/ledger' },
    { path: '/ledger', component: LedgerView },
    { path: '/notes', component: NotesView },
    { path: '/notes/:id', component: RecordView },
    { path: '/settings', component: SettingsView },
    { path: '/appearance', component: AppearanceView },
    { path: '/categories', component: CategoriesView },
    { path: '/:pathMatch(.*)*', redirect: '/ledger' },
  ],
})
createApp(App).use(createPinia()).use(router).mount('#app')
