<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { historyApi, type QaRecord } from '@/api'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()
const isAdmin = ref(userStore.role === 'admin')

const loading = ref(false)
const list = ref<QaRecord[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
const viewAll = ref(false)

const detailVisible = ref(false)
const current = ref<QaRecord | null>(null)

async function load() {
  loading.value = true
  try {
    const res = await historyApi.list({
      all: viewAll.value || undefined,
      page: page.value,
      pageSize: pageSize.value,
    })
    list.value = res.list
    total.value = res.total
  } finally {
    loading.value = false
  }
}

function showDetail(record: QaRecord) {
  current.value = record
  detailVisible.value = true
}

async function removeRecord(record: QaRecord) {
  await ElMessageBox.confirm('确定删除这条问答记录吗？', '删除确认', {
    type: 'warning',
  })
  await historyApi.remove(record._id)
  ElMessage.success('已删除')
  if (list.value.length === 1 && page.value > 1) page.value--
  load()
}

async function clearAll() {
  await ElMessageBox.confirm(
    '确定清空全部问答记录吗？此操作不可恢复。',
    '清空确认',
    { type: 'warning' },
  )
  await historyApi.clear()
  ElMessage.success('已清空')
  page.value = 1
  load()
}

function toggleView() {
  viewAll.value = !viewAll.value
  page.value = 1
  load()
}

function formatTime(iso: string) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

onMounted(load)
</script>

<template>
  <div class="history-page">
    <el-card shadow="never">
      <template #header>
        <div class="header-bar">
          <span style="font-weight: 600">
            {{ viewAll ? '全部问答记录' : '我的问答记录' }}
          </span>
          <div class="header-actions">
            <el-switch
              v-if="isAdmin"
              v-model="viewAll"
              active-text="查看全部"
              @change="toggleView"
            />
            <el-button
              type="danger"
              plain
              size="small"
              :disabled="!list.length"
              @click="clearAll"
            >
              清空记录
            </el-button>
          </div>
        </div>
      </template>

      <el-empty
        v-if="!loading && !list.length"
        description="暂无问答记录，去「智能问答」问一个问题吧"
      />

      <el-table
        v-else
        :data="list"
        v-loading="loading"
        stripe
        class="record-table"
      >
        <el-table-column label="问题" min-width="220">
          <template #default="{ row }">
            <span class="question-cell" @click="showDetail(row)">
              {{ row.question }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="回答摘要" min-width="260">
          <template #default="{ row }">
            <span class="answer-preview">{{ row.answer.slice(0, 60) }}</span>
          </template>
        </el-table-column>
        <el-table-column v-if="viewAll" label="用户" width="110">
          <template #default="{ row }">
            <span>{{ row.username }}</span>
            <el-tag v-if="row.identity" size="small" type="warning" class="id-tag">
              {{ row.identity }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="图谱命中断言" width="130">
          <template #default="{ row }">
            <el-tag :type="row.graphMatched ? 'success' : 'info'" size="small">
              {{ row.graphMatched ? '命中' : '未命中' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="170">
          <template #default="{ row }">
            {{ formatTime(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="showDetail(row)">
              查看
            </el-button>
            <el-button link type="danger" size="small" @click="removeRecord(row)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="total > pageSize" class="pager">
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="prev, pager, next, total"
          @current-change="load"
        />
      </div>
    </el-card>

    <el-drawer v-model="detailVisible" size="45%" title="问答详情">
      <div v-if="current" class="detail">
        <div class="detail-row">
          <span class="d-label">问题</span>
          <div class="d-value question">{{ current.question }}</div>
        </div>
        <div class="detail-row">
          <span class="d-label">回答</span>
          <div class="d-value answer">{{ current.answer }}</div>
        </div>
        <div v-if="current.entityNames?.length" class="detail-row">
          <span class="d-label">关联实体</span>
          <div class="d-value">
            <el-tag
              v-for="name in current.entityNames"
              :key="name"
              size="small"
              class="entity-tag"
            >
              {{ name }}
            </el-tag>
          </div>
        </div>
        <div class="detail-row">
          <span class="d-label">信息来源</span>
          <div class="d-value">
            <el-tag size="small" :type="current.graphMatched ? 'success' : 'info'">
              {{ current.graphMatched ? '知识图谱' : '模型直答' }}
            </el-tag>
            <el-tag v-if="current.provider" size="small" type="primary">
              {{ current.provider }}
            </el-tag>
          </div>
        </div>
        <div class="detail-row">
          <span class="d-label">提问身份</span>
          <div class="d-value">{{ current.identity || '普通用户' }}</div>
        </div>
        <div class="detail-row">
          <span class="d-label">提问时间</span>
          <div class="d-value">{{ formatTime(current.createdAt) }}</div>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}

.question-cell {
  color: #409eff;
  cursor: pointer;
  font-weight: 500;
}

.question-cell:hover {
  text-decoration: underline;
}

.answer-preview {
  color: #606266;
  font-size: 13px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.id-tag {
  margin-left: 6px;
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.detail {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.detail-row {
  display: flex;
  gap: 12px;
}

.d-label {
  width: 68px;
  flex-shrink: 0;
  color: #909399;
  font-size: 14px;
  padding-top: 2px;
}

.d-value {
  flex: 1;
  color: #303133;
  font-size: 14px;
  line-height: 1.7;
  word-break: break-all;
}

.d-value.question {
  font-weight: 600;
}

.d-value.answer {
  background: #f5f7fa;
  border-radius: 8px;
  padding: 12px;
  white-space: pre-wrap;
}

.entity-tag {
  margin: 0 6px 6px 0;
}
</style>