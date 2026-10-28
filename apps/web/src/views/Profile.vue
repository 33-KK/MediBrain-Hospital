<script setup lang="ts">
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()
</script>

<template>
  <div class="profile-page">
    <el-card shadow="never" class="profile-card">
      <template #header>
        <span style="font-weight: 600">个人中心</span>
      </template>

      <div class="profile-body">
        <el-avatar :size="72" class="profile-avatar">
          {{ (userStore.user?.username || 'U')[0]?.toUpperCase() }}
        </el-avatar>
        <div class="profile-info">
          <div class="row">
            <span class="label">用户名</span>
            <span class="value">{{ userStore.user?.username }}</span>
          </div>
          <div class="row">
            <span class="label">登录状态</span>
            <el-tag type="success">已登录</el-tag>
          </div>
        </div>
      </div>
    </el-card>

    <el-card shadow="never" class="tip-card">
      <template #header>
        <span style="font-weight: 600">使用提示</span>
      </template>
      <ul class="tips">
        <li>在「智能问答」中，输入疾病相关问题即可获得基于知识图谱的回答</li>
        <li>点击回答中的实体标签或来源链接，可跳转到对应疾病详情</li>
        <li>在「知识图谱」中，可输入疾病名称查看其 8 类关系的可视化图谱</li>
        <li>回答仅供参考，不能替代专业医疗诊断</li>
      </ul>
    </el-card>
  </div>
</template>

<style scoped>
.profile-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 720px;
}

.profile-body {
  display: flex;
  align-items: center;
  gap: 32px;
  padding: 12px 0;
}

.profile-avatar {
  background: #409eff;
  color: #fff;
  font-size: 28px;
  font-weight: 600;
}

.profile-info {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.label {
  width: 80px;
  color: #909399;
  font-size: 14px;
}

.value {
  color: #303133;
  font-size: 14px;
  font-weight: 500;
}

.tips {
  padding-left: 18px;
  color: #606266;
  line-height: 2;
  font-size: 14px;
}
</style>
