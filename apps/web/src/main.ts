import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/message-box/style/css'
import { FirstAidKit, ChatDotRound, Share, Files, Clock, EditPen, User, ArrowDown, Delete } from '@element-plus/icons-vue'
import App from './App.vue'
import router from './router'
import './style.css'

// An open tab may request an old lazy chunk after a deployment. Refresh once;
// index.html is never cached, so the retry loads the current asset manifest.
window.addEventListener('vite:preloadError', (event) => {
  const key = 'medibrain-preload-retry'
  const previous = Number(sessionStorage.getItem(key) ?? 0)
  if (Date.now() - previous < 60_000) return
  event.preventDefault()
  sessionStorage.setItem(key, String(Date.now()))
  window.location.reload()
})

const app = createApp(App)

for (const [key, component] of Object.entries({ FirstAidKit, ChatDotRound, Share, Files, Clock, EditPen, User, ArrowDown, Delete })) {
  app.component(key, component)
}

app.use(createPinia())
app.use(router)

app.mount('#app')
