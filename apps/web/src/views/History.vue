<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { historyApi, type QaRecord } from '@/api'
import { useRouter } from 'vue-router'
import AnswerEvidence from '@/components/AnswerEvidence.vue'

const router = useRouter()
const loading = ref(false)
const list = ref<QaRecord[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)

const detailVisible = ref(false)
const current = ref<QaRecord | null>(null)
let loadVersion = 0
let mounted = true

async function load() {
  const version = ++loadVersion
  loading.value = true
  try {
    const res = await historyApi.list({
      page: page.value,
      pageSize: pageSize.value,
    })
    if (version === loadVersion && mounted) {
      list.value = res.list
      total.value = res.total
    }
  } finally {
    if (version === loadVersion) loading.value = false
  }
}

function showDetail(record: QaRecord) {
  current.value = record
  detailVisible.value = true
}

async function removeRecord(record: QaRecord) {
  try {
    await ElMessageBox.confirm('确定删除这条问答记录吗？', '删除确认', { type: 'warning' })
    await historyApi.remove(record._id)
    ElMessage.success('已删除')
    if (current.value?._id === record._id) { detailVisible.value = false; current.value = null }
    if (list.value.length === 1 && page.value > 1) page.value--
    await load()
  } catch { /* 用户取消或请求失败，错误由 HTTP 拦截器提示。 */ }
}

async function clearAll() {
  try {
    await ElMessageBox.confirm('确定清空我的全部问答记录及会话吗？此操作不可恢复。', '清空确认', { type: 'warning' })
    await historyApi.clear()
    ElMessage.success('已清空')
    detailVisible.value = false
    current.value = null
    page.value = 1
    await load()
  } catch { /* 用户取消或请求失败，错误由 HTTP 拦截器提示。 */ }
}

function formatTime(iso: string) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

function sourceLabel(record: QaRecord) {
  if (record.snapshot?.grounding?.mode === 'document-excerpts') return record.snapshot.documentEvidence?.length ? '资料原文摘录' : '资料问答 · 未命中'
  if (record.documentId) return '资料问答 · 旧记录'
  if (record.snapshot?.grounding?.mode === 'reference-library') return record.snapshot.references?.length ? '相关资料检索' : '资料检索 · 未命中'
  if (record.graphMatched) return '知识图谱'
  return record.snapshot ? '依据不足／需补充' : '旧记录 · 来源未保存'
}

onMounted(() => { void load().catch(() => ElMessage.error('历史记录暂时无法加载')) })
onUnmounted(() => { mounted = false; loadVersion++ })
</script>

<template>
  <div class="history-page">
    <el-card shadow="never">
      <template #header>
        <div class="header-bar">
          <span style="font-weight: 600">
            我的问答记录
          </span>
          <div class="header-actions">
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
            <span class="question-cell" @click="showDetail(row as QaRecord)">
              {{ row.question }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="回答摘要" min-width="260">
          <template #default="{ row }">
            <span class="answer-preview">{{ row.answer.slice(0, 60) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="信息来源" width="150">
          <template #default="{ row }">
            <el-tag :type="row.graphMatched ? 'success' : 'info'" size="small">
              {{ sourceLabel(row as QaRecord) }}
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
            <el-button link type="primary" size="small" @click="showDetail(row as QaRecord)">
              查看
            </el-button>
            <el-button link type="danger" size="small" @click="removeRecord(row as QaRecord)">
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

    <el-drawer v-model="detailVisible" size="min(680px, 94vw)" title="问答详情">
      <div v-if="current" class="detail">
        <el-button v-if="current.conversationId" type="primary" plain @click="router.push({ path: '/chat', query: { conversationId: current.conversationId } })">打开会话，继续追问</el-button>
        <div class="detail-row">
          <span class="d-label">问题</span>
          <div class="d-value question">{{ current.question }}</div>
        </div>
        <div class="detail-row">
          <span class="d-label">回答</span>
          <div class="d-value answer"><div v-if="!current.snapshot?.sections?.length" class="plain-answer">{{ current.answer }}</div><AnswerEvidence v-if="current.snapshot" :detail="current.snapshot" /><p v-else class="legacy-note">这条旧记录未保存详细引用，无法还原当时的证据。</p><p class="legacy-note">回答仅供医学知识参考，不能替代专业诊断与治疗。</p></div>
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
              {{ sourceLabel(current) }}
            </el-tag>
            <el-tag v-if="current.provider" size="small" type="primary">
              {{ current.provider }}
            </el-tag>
          </div>
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
  color: var(--mb-accent, #c55220);
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
}

.plain-answer { white-space: pre-wrap; }
.legacy-note { margin: 12px 0 0; font-size: 11px; line-height: 1.8; color: #909399; }
@media (max-width: 480px) { .detail-row { flex-direction: column; gap: 6px; } .header-bar { gap: 12px; } }

.entity-tag {
  margin: 0 6px 6px 0;
}
</style>
