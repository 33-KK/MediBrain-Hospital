<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const userStore = useUserStore()

const mode = ref<'login' | 'register'>('login')
const formRef = ref<FormInstance>()
const loading = ref(false)

const form = reactive({
  username: '',
  password: '',
  identity: '普通用户',
})

const IDENTITY_OPTIONS = [
  '医生',
  '护士',
  '药师',
  '医学生',
  '患者',
  '患者家属',
  '普通用户',
]

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

async function submit() {
  await formRef.value?.validate()
  loading.value = true
  try {
    if (mode.value === 'login') {
      await userStore.login(form.username, form.password)
      ElMessage.success('登录成功')
    } else {
      await userStore.register(form.username, form.password, form.identity)
      await userStore.login(form.username, form.password)
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
    <div class="card">
      <div class="brand">
        <el-icon :size="40" color="#409EFF"><FirstAidKit /></el-icon>
        <h1>MediBrain-Hospital</h1>
        <p>医疗知识图谱智能问答平台</p>
      </div>

      <el-tabs v-model="mode" stretch>
        <el-tab-pane label="登录" name="login">
          <el-form ref="formRef" :model="form" :rules="rules" size="large">
            <el-form-item prop="username">
              <el-input v-model="form.username" placeholder="用户名" :prefix-icon="'User'" />
            </el-form-item>
            <el-form-item prop="password">
              <el-input v-model="form.password" type="password" placeholder="密码" show-password :prefix-icon="'Lock'" @keyup.enter="submit" />
            </el-form-item>
            <el-button type="primary" class="submit" size="large" :loading="loading" @click="submit">
              登 录
            </el-button>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="注册" name="register">
          <el-form ref="formRef" :model="form" :rules="rules" size="large">
            <el-form-item prop="username">
              <el-input v-model="form.username" placeholder="用户名（至少 3 位）" :prefix-icon="'User'" />
            </el-form-item>
            <el-form-item prop="identity">
              <el-select
                v-model="form.identity"
                placeholder="选择您的身份"
                size="large"
                style="width: 100%"
              >
                <el-option
                  v-for="opt in IDENTITY_OPTIONS"
                  :key="opt"
                  :label="opt"
                  :value="opt"
                />
              </el-select>
            </el-form-item>
            <el-form-item prop="password">
              <el-input v-model="form.password" type="password" placeholder="密码（至少 6 位）" show-password :prefix-icon="'Lock'" @keyup.enter="submit" />
            </el-form-item>
            <el-button type="primary" class="submit" size="large" :loading="loading" @click="submit">
              注 册
            </el-button>
          </el-form>
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #e8f4fd 0%, #f0f7ff 50%, #e3f0fa 100%);
}

.card {
  width: 420px;
  padding: 40px 36px 24px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
}

.brand {
  text-align: center;
  margin-bottom: 24px;
}

.brand h1 {
  margin-top: 8px;
  font-size: 22px;
  color: #303133;
}

.brand p {
  margin-top: 6px;
  font-size: 13px;
  color: #909399;
}

.submit {
  width: 100%;
  margin-top: 8px;
}
</style>
