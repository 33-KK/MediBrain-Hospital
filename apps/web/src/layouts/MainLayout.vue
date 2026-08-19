<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { computed } from 'vue'
import { useUserStore } from '@/stores/user'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const activeMenu = computed(() => route.path)
const userRole = computed(() => userStore.role || 'user')

function handleCommand(cmd: string) {
  if (cmd === 'profile') router.push('/profile')
  if (cmd === 'logout') {
    userStore.logout()
    router.push('/login')
  }
}
</script>

<template>
  <el-container class="layout">
    <el-aside width="220px" class="aside">
      <div class="logo">
        <el-icon :size="26" color="#409EFF"><FirstAidKit /></el-icon>
        <span class="logo-text">MediBrain</span>
      </div>
      <el-menu :default-active="activeMenu" router class="menu">
        <el-menu-item index="/chat">
          <el-icon><ChatDotRound /></el-icon>
          <span>智能问答</span>
        </el-menu-item>
        <el-menu-item index="/graph">
          <el-icon><Share /></el-icon>
          <span>知识图谱</span>
        </el-menu-item>
        <el-menu-item index="/disease">
          <el-icon><Files /></el-icon>
          <span>疾病详情</span>
        </el-menu-item>
        <el-menu-item index="/history">
          <el-icon><Clock /></el-icon>
          <span>问答历史</span>
        </el-menu-item>
        <el-menu-item
          v-if="userStore.role === 'admin' || userStore.user?.identity === '医生'"
          index="/graph-manage"
        >
          <el-icon><EditPen /></el-icon>
          <span>图谱管理</span>
        </el-menu-item>
        <el-menu-item index="/profile">
          <el-icon><User /></el-icon>
          <span>个人中心</span>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="header">
        <div class="header-title">{{ route.meta.title || '' }}</div>
        <el-dropdown @command="handleCommand">
          <span class="user-trigger">
            <el-avatar :size="30" class="avatar">{{ (userStore.user?.username || 'U')[0]?.toUpperCase() }}</el-avatar>
            <span class="username">{{ userStore.user?.username }}</span>
            <el-tag size="small" :type="userRole === 'admin' ? 'danger' : 'info'" class="role-tag">
              {{ userRole }}
            </el-tag>
            <el-icon><ArrowDown /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="profile">个人中心</el-dropdown-item>
              <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </el-header>

      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.layout {
  height: 100%;
}

.aside {
  background: #fff;
  border-right: 1px solid #e4e7ed;
  display: flex;
  flex-direction: column;
}

.logo {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-bottom: 1px solid #e4e7ed;
}

.logo-text {
  font-size: 20px;
  font-weight: 700;
  color: #303133;
}

.menu {
  border-right: none;
  flex: 1;
}

.header {
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 60px;
}

.header-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

.user-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  outline: none;
}

.avatar {
  background: #409eff;
  color: #fff;
  font-weight: 600;
}

.username {
  font-size: 14px;
  color: #303133;
}

.role-tag {
  margin-left: 2px;
}

.main {
  padding: 20px;
  overflow-y: auto;
}
</style>
