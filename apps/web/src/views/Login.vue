<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { FirstAidKit, User, Lock } from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const userStore = useUserStore()

const mode = ref<'login' | 'register'>('login')
const formRef = ref<FormInstance>()
const loading = ref(false)

const form = reactive({
  username: '',
  password: '',
})

const rules: FormRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 3, message: '用户名至少 3 个字符', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码至少 6 位', trigger: 'blur' },
  ],
}

watch(mode, () => formRef.value?.clearValidate())

async function submit() {
  if (loading.value || !formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid || loading.value) return
  loading.value = true
  try {
    if (mode.value === 'login') {
      await userStore.login(form.username, form.password)
      ElMessage.success('登录成功')
    } else {
      await userStore.register(form.username, form.password)
      ElMessage.success('注册成功，已自动登录')
    }
    router.push('/chat')
  } catch {
    // 错误已由拦截器提示
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <header class="login-header">
      <span class="header-brand"><el-icon :size="27"><FirstAidKit /></el-icon>MediBrain</span>
      <span class="header-subtitle">医疗知识图谱智能问答平台</span>
    </header>
    <main class="login-main">
      <section class="login-card" aria-labelledby="login-title">
        <div class="welcome">
          <span class="welcome-icon"><el-icon :size="29"><FirstAidKit /></el-icon></span>
          <h1 id="login-title">{{ mode === 'login' ? '欢迎来到 MediBrain' : '创建 MediBrain 账号' }}</h1>
          <p>让医学知识更易查找，让健康问题有据可循</p>
        </div>

        <el-tabs v-model="mode" stretch class="login-tabs">
          <el-tab-pane label="登录" name="login" :disabled="loading" />
          <el-tab-pane label="注册" name="register" :disabled="loading" />
        </el-tabs>

        <el-form ref="formRef" :model="form" :rules="rules" size="large" label-position="top" @submit.prevent="submit">
          <el-form-item label="用户名" prop="username">
            <el-input v-model="form.username" :placeholder="mode === 'register' ? '设置用户名，至少 3 个字符' : '请输入用户名'" :prefix-icon="User" autocomplete="username" :disabled="loading" />
          </el-form-item>
          <el-form-item label="密码" prop="password">
            <el-input v-model="form.password" type="password" :placeholder="mode === 'register' ? '设置密码，至少 6 位' : '请输入密码'" show-password :prefix-icon="Lock" :autocomplete="mode === 'register' ? 'new-password' : 'current-password'" :disabled="loading" />
          </el-form-item>
          <el-button type="primary" native-type="submit" class="submit" size="large" :loading="loading">
            {{ mode === 'login' ? '登录' : '注册并进入' }}
          </el-button>
        </el-form>
        <p class="login-note">知识查询 · 图谱探索 · 智能问答</p>
      </section>
      <p class="login-footer">医学知识辅助参考，不能替代专业诊断与治疗</p>
    </main>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  background: #fcfaf7;
}

.login-header {
  min-height: 80px;
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 20px 40px;
  border-bottom: 1px solid #f0e5da;
  background: #fff5eb;
}

.header-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--mb-accent);
  font-size: 25px;
  font-weight: 750;
  letter-spacing: -.7px;
}

.header-subtitle {
  color: #88796c;
  font-size: 13px;
}

.login-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 22px;
  padding: 44px 20px;
}

.login-card {
  width: min(100%, 432px);
  padding: 34px 36px 26px;
  border: 1px solid #eee7df;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 10px 32px rgba(91, 59, 28, .045);
}

.welcome {
  text-align: center;
  margin-bottom: 24px;
}

.welcome-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  margin-bottom: 15px;
  border-radius: 14px;
  background: var(--mb-accent-soft);
  color: var(--mb-accent);
}

.welcome h1 {
  color: var(--mb-text);
  font-size: 22px;
  font-weight: 650;
  letter-spacing: -.4px;
}

.welcome p {
  margin-top: 9px;
  color: var(--mb-muted);
  font-size: 12px;
  line-height: 1.7;
}

.login-tabs { margin-bottom: 22px; }
.login-tabs :deep(.el-tabs__header) { margin-bottom: 0; }
.login-tabs :deep(.el-tabs__nav-wrap::after) {
  height: 1px;
  background: var(--mb-line);
}
.login-tabs :deep(.el-tabs__item) {
  font-size: 15px;
  font-weight: 500;
}
.login-card :deep(.el-form-item) { margin-bottom: 22px; }
.login-card :deep(.el-form-item__label) {
  margin-bottom: 7px;
  color: #56585b;
  font-size: 13px;
}
.login-card :deep(.el-input__wrapper) {
  min-height: 44px;
  border-radius: 7px;
}
.login-card :deep(.el-input__prefix) { color: #a3a19d; }

.submit {
  width: 100%;
  height: 44px;
  margin-top: 6px;
  border-radius: 7px;
  font-weight: 600;
}

.login-note {
  margin-top: 24px;
  color: #9c948c;
  text-align: center;
  font-size: 11px;
  letter-spacing: 1px;
}

.login-footer {
  color: #8b8781;
  text-align: center;
  font-size: 11px;
  line-height: 1.7;
}

@media (max-width: 600px) {
  .login-header {
    min-height: 72px;
    padding: 17px 20px;
    gap: 6px;
    align-items: flex-start;
    flex-direction: column;
  }
  .header-brand { font-size: 23px; }
  .header-subtitle { margin-left: 37px; font-size: 10px; }
  .login-main { padding: 30px 18px; }
  .login-card { padding: 28px 24px 22px; }
  .welcome h1 { font-size: 20px; }
}
</style>
