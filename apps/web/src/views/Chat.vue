<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { qaApi, ttsApi, type QaResponse } from '@/api'
import { useRouter } from 'vue-router'

const router = useRouter()

interface MessageItem {
  role: 'user' | 'assistant'
  content: string
  detail?: QaResponse
  loading?: boolean
  playing?: boolean
}

const messages = ref<MessageItem[]>([])
const input = ref('')
const sending = ref(false)
const chatBody = ref<HTMLElement>()
const audioEl = new Audio()
let playingIndex = -1

const suggestions = [
  '高血压的宜吃食物有哪些？',
  '感冒了吃什么药好得快？',
  '冠心病患者需要做什么检查？',
  '糖尿病的常见症状是什么？',
  '得了胃溃疡饮食上要注意什么？',
  '高血压的忌吃食物有哪些？',
]

async function scrollToBottom() {
  await nextTick()
  chatBody.value?.scrollTo({ top: chatBody.value.scrollHeight, behavior: 'smooth' })
}

async function send(text?: string) {
  const question = (text ?? input.value).trim()
  if (!question || sending.value) return

  messages.value.push({ role: 'user', content: question })
  const assistant: MessageItem = { role: 'assistant', content: '', loading: true }
  messages.value.push(assistant)
  input.value = ''
  sending.value = true
  await scrollToBottom()

  try {
    const res = await qaApi.ask(question)
    assistant.content = res.answer
    assistant.detail = res
  } catch {
    assistant.content = '抱歉，问答服务暂时不可用，请稍后重试。'
  } finally {
    assistant.loading = false
    sending.value = false
    await scrollToBottom()
  }
}

async function playSpeech(msg: MessageItem, index: number) {
  if (!msg.content) return
  if (playingIndex === index) {
    audioEl.pause()
    audioEl.currentTime = 0
    msg.playing = false
    playingIndex = -1
    return
  }
  audioEl.pause()
  if (playingIndex >= 0) messages.value[playingIndex].playing = false

  try {
    const blob = await ttsApi.synthesize(msg.content)
    audioEl.src = URL.createObjectURL(blob)
    msg.playing = true
    playingIndex = index
    audioEl.onended = () => {
      msg.playing = false
      playingIndex = -1
      URL.revokeObjectURL(audioEl.src)
    }
    await audioEl.play()
  } catch {
    ElMessage.error('语音合成失败，请稍后重试')
    msg.playing = false
    playingIndex = -1
  }
}

function goDisease(name: string) {
  router.push({ path: '/disease', query: { name } })
}

function isDisease(label?: string) {
  return label === '疾病'
}
</script>

<template>
  <div class="chat-page">
    <div ref="chatBody" class="chat-body">
      <div v-if="messages.length === 0" class="welcome">
        <el-icon :size="48" color="#409EFF"><FirstAidKit /></el-icon>
        <h2>MediBrain 智能医疗问答</h2>
        <p>基于 4.9 万节点医学知识图谱，为您提供疾病症状、饮食、用药、检查等专业解答</p>
        <div class="suggestions">
          <el-tag
            v-for="s in suggestions"
            :key="s"
            class="suggestion"
            effect="plain"
            @click="send(s)"
          >
            {{ s }}
          </el-tag>
        </div>
      </div>

      <div v-for="(msg, i) in messages" :key="i" class="msg-row" :class="msg.role">
        <el-avatar
          class="msg-avatar"
          :style="{ background: msg.role === 'user' ? '#409EFF' : '#67C23A' }"
        >
          {{ msg.role === 'user' ? '我' : 'AI' }}
        </el-avatar>
        <div class="msg-bubble">
          <div v-if="msg.loading" class="loading">
            <span class="dot"></span><span class="dot"></span><span class="dot"></span>
          </div>
          <div v-else class="msg-text">{{ msg.content }}</div>

          <div v-if="msg.detail" class="msg-meta">
            <el-tag v-if="msg.detail.dimension" size="small" type="warning" effect="plain">
              维度：{{ msg.detail.dimension }}
            </el-tag>
            <el-tag v-if="msg.detail.graphMatched" size="small" type="success" effect="plain">
              图谱命中
            </el-tag>
            <el-tag v-if="msg.detail.vectorMatched" size="small" type="primary" effect="plain">
              向量检索命中
            </el-tag>
            <el-tag size="small" type="info" effect="plain">
              {{ msg.detail.provider }}
            </el-tag>
          </div>

          <div v-if="msg.detail?.vectorCandidates?.length" class="msg-vector">
            <span class="vector-label">语义候选：</span>
            <el-tag
              v-for="(c, ci) in msg.detail.vectorCandidates.slice(0, 5)"
              :key="ci"
              size="small"
              :type="isDisease(c.type) ? 'primary' : 'info'"
              effect="light"
              class="vector-chip"
              :class="{ clickable: isDisease(c.type) }"
              @click="isDisease(c.type) && goDisease(c.name)"
            >
              {{ c.name }}（{{ (c.score * 100).toFixed(0) }}%）
            </el-tag>
          </div>

          <div v-if="!msg.loading && msg.content" class="msg-actions">
            <el-button
              size="small"
              :type="msg.playing ? 'danger' : 'primary'"
              :icon="msg.playing ? 'VideoPause' : 'VideoPlay'"
              circle
              plain
              :title="msg.playing ? '停止播放' : '播放语音'"
              @click="playSpeech(msg, i)"
            />
          </div>

          <div v-if="msg.detail?.entities.length" class="msg-entities">
            <el-tag
              v-for="e in msg.detail.entities"
              :key="e.name"
              size="small"
              :type="isDisease(e.type) ? 'primary' : 'info'"
              class="entity-chip"
              :class="{ clickable: isDisease(e.type) }"
              @click="isDisease(e.type) && goDisease(e.name)"
            >
              {{ e.name }} · {{ e.type }}
            </el-tag>
          </div>

          <div v-if="msg.detail?.sources.length" class="msg-sources">
            <span class="sources-label">图谱来源：</span>
            <template v-for="(s, si) in msg.detail.sources.slice(0, 8)" :key="si">
              <el-link
                v-if="isDisease(s.label)"
                type="primary"
                class="source-link"
                @click="goDisease(s.entity)"
              >
                {{ s.entity }}
              </el-link>
              <el-tag v-else size="small" type="info" effect="plain" class="source-tag">
                {{ s.entity }}（{{ s.label }}）
              </el-tag>
            </template>
          </div>
        </div>
      </div>
    </div>

    <div class="chat-input">
      <el-input
        v-model="input"
        placeholder="请输入您的医学问题，如：高血压的宜吃食物有哪些？"
        size="large"
        :disabled="sending"
        @keyup.enter="send()"
      >
        <template #append>
          <el-button type="primary" :loading="sending" :icon="'Promotion'" @click="send()">
            发送
          </el-button>
        </template>
      </el-input>
    </div>
  </div>
</template>

<style scoped>
.chat-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}

.chat-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.welcome {
  text-align: center;
  margin-top: 60px;
}

.welcome h2 {
  margin: 12px 0 8px;
  color: #303133;
}

.welcome p {
  color: #909399;
  font-size: 14px;
  margin-bottom: 24px;
}

.suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
  max-width: 640px;
  margin: 0 auto;
}

.suggestion {
  cursor: pointer;
  font-size: 13px;
}

.msg-row {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
}

.msg-row.user {
  flex-direction: row-reverse;
}

.msg-avatar {
  flex-shrink: 0;
  color: #fff;
  font-weight: 600;
}

.msg-bubble {
  max-width: 72%;
}

.msg-row.user .msg-bubble {
  background: #ecf5ff;
  border-radius: 12px 4px 12px 12px;
  padding: 12px 16px;
}

.msg-row.assistant .msg-bubble {
  background: #f4f4f5;
  border-radius: 4px 12px 12px 12px;
  padding: 12px 16px;
}

.msg-text {
  color: #303133;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 14px;
}

.msg-meta {
  display: flex;
  gap: 8px;
  margin-top: 10px;
  flex-wrap: wrap;
}

.msg-actions {
  margin-top: 10px;
  display: flex;
  align-items: center;
}

.msg-entities {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.entity-chip {
  cursor: default;
}

.entity-chip.clickable {
  cursor: pointer;
}

.msg-sources {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 12px;
  color: #909399;
}

.msg-vector {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 12px;
}

.vector-label {
  color: #909399;
}

.vector-chip.clickable {
  cursor: pointer;
}

.source-link {
  font-size: 12px;
}

.loading {
  display: flex;
  gap: 6px;
  padding: 4px 0;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #c0c4cc;
  animation: bounce 1.2s infinite;
}

.dot:nth-child(2) {
  animation-delay: 0.2s;
}

.dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes bounce {
  0%, 80%, 100% {
    transform: translateY(0);
    opacity: 0.6;
  }
  40% {
    transform: translateY(-6px);
    opacity: 1;
  }
}

.chat-input {
  padding: 16px 24px;
  border-top: 1px solid #e4e7ed;
  background: #fff;
  border-radius: 0 0 8px 8px;
}
</style>
