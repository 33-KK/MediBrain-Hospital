<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { computed } from 'vue'
import { ChatDotRound, Clock, Files, FirstAidKit, Share, User } from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/user'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const isChat = computed(() => route.path === '/chat')
const navigation = [
  { path: '/chat', label: '智能问答', icon: ChatDotRound },
  { path: '/graph', label: '知识图谱', icon: Share },
  { path: '/knowledge', label: '医学资料库', icon: Files },
  { path: '/disease', label: '疾病详情', icon: FirstAidKit },
  { path: '/history', label: '问答历史', icon: Clock },
  { path: '/profile', label: '个人中心', icon: User },
]

function handleCommand(cmd: string) {
  if (cmd === 'profile') router.push('/profile')
  if (cmd === 'logout') {
    userStore.logout()
    router.push('/login')
  }
}
</script>

<template>
  <div class="app-shell">
    <header class="header">
      <router-link to="/chat" class="brand" aria-label="MediBrain 智能问答首页">
        <span class="brand-mark"><el-icon :size="31"><FirstAidKit /></el-icon></span>
        <span class="brand-copy">
          <span class="brand-name">MediBrain</span>
          <span class="brand-subtitle">医疗知识图谱智能问答平台</span>
        </span>
      </router-link>
      <el-dropdown @command="handleCommand">
        <button type="button" class="user-trigger" aria-label="打开账号菜单">
          <el-avatar :size="34" class="avatar">{{ (userStore.user?.username || 'U')[0]?.toUpperCase() }}</el-avatar>
          <span class="username">{{ userStore.user?.username }}</span>
          <el-icon class="user-chevron"><ArrowDown /></el-icon>
        </button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="profile">个人中心</el-dropdown-item>
            <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </header>
    <div class="shell-body">
      <aside class="sidebar">
        <p class="sidebar-label">工作台</p>
        <nav class="navigation" aria-label="主导航">
          <router-link
            v-for="item in navigation"
            :key="item.path"
            :to="item.path"
            class="nav-item"
            :class="{ 'is-active': route.path === item.path }"
            :aria-current="route.path === item.path ? 'page' : undefined"
          >
            <el-icon :size="19"><component :is="item.icon" /></el-icon>
            <span>{{ item.label }}</span>
          </router-link>
        </nav>
      </aside>
      <main class="main" :class="{ 'is-chat': isChat }">
        <router-view />
      </main>
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
}

.header {
  height: 80px;
  flex: 0 0 80px;
  padding: 0 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  background: #fff5eb;
  border-bottom: 1px solid #f0e5da;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 11px;
  text-decoration: none;
  min-width: 0;
}

.brand-mark {
  display: flex;
  color: #d2632d;
}

.brand-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.brand-name {
  color: var(--mb-accent);
  font-size: 25px;
  font-weight: 750;
  letter-spacing: -.7px;
  line-height: 1.15;
}

.brand-subtitle {
  color: #877466;
  font-size: 11px;
  letter-spacing: 1px;
}

.user-trigger {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0 6px 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--mb-text);
  cursor: pointer;
  font: inherit;
}

.user-trigger:focus-visible,
.brand:focus-visible,
.nav-item:focus-visible {
  outline: 2px solid var(--mb-accent);
  outline-offset: 3px;
}

.avatar {
  background: #f5ddc9;
  color: #a14d23;
  font-weight: 650;
}

.username {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
}

.user-chevron {
  margin-left: 3px;
  color: #8d8177;
  font-size: 12px;
}

.shell-body {
  flex: 1;
  display: flex;
  min-height: 0;
  min-width: 0;
}

.sidebar {
  width: 208px;
  flex: 0 0 208px;
  padding: 29px 14px;
  border-right: 1px solid var(--mb-line);
  background: #fff;
  overflow-y: auto;
}

.sidebar-label {
  margin: 0 15px 16px;
  color: #9b9a98;
  font-size: 11px;
  letter-spacing: 2px;
}

.navigation {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 12px 16px;
  border-radius: 7px;
  color: #6f747b;
  text-decoration: none;
  white-space: nowrap;
  font-size: 14px;
  transition: background .15s ease, color .15s ease;
}

.nav-item .el-icon {
  color: #92969c;
}

.nav-item:hover {
  background: #faf7f3;
  color: var(--mb-text);
}

.nav-item.is-active {
  background: var(--mb-accent-soft);
  color: var(--mb-accent);
  font-weight: 600;
}

.nav-item.is-active .el-icon {
  color: var(--mb-accent);
}

.main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 28px 32px;
  overflow-y: auto;
  background: #fdfcfb;
}

.main.is-chat {
  padding: 0;
  min-height: 0;
  overflow: hidden;
  background: #fff;
}

@media (max-width: 760px) {
  .header {
    height: 72px;
    flex-basis: 72px;
    padding: 0 18px;
    gap: 12px;
  }
  .brand-name { font-size: 23px; }
  .brand-subtitle { letter-spacing: 0; font-size: 10px; }
  .shell-body { flex-direction: column; }
  .sidebar {
    width: 100%;
    flex: 0 0 auto;
    padding: 9px 12px;
    border-right: 0;
    border-bottom: 1px solid var(--mb-line);
    overflow-x: auto;
    overflow-y: hidden;
  }
  .sidebar-label { display: none; }
  .navigation {
    width: max-content;
    min-width: 100%;
    flex-direction: row;
    gap: 5px;
  }
  .nav-item {
    min-height: 39px;
    gap: 7px;
    padding: 9px 12px;
    font-size: 13px;
  }
  .nav-item .el-icon { font-size: 16px !important; }
  .main { padding: 20px 16px; }
}

@media (max-width: 440px) {
  .username, .user-chevron { display: none; }
  .brand { gap: 8px; }
}
</style>
