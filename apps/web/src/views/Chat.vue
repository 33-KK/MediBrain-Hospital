<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ChatLineRound, CopyDocument, FirstAidKit, Loading, Plus, Promotion,
  RefreshRight, VideoPause, VideoPlay, User, EditPen, Tickets,
} from '@element-plus/icons-vue'
import { conversationApi, knowledgeApi, qaApi, ttsApi, type ConversationSummary, type QaResponse } from '@/api'
import AnswerEvidence from '@/components/AnswerEvidence.vue'
import { onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'

const router = useRouter()
const route = useRoute()

interface MessageItem {
  role: 'user' | 'assistant'
  content: string
  detail?: QaResponse
  loading?: boolean
  saveWarning?: string
}

const messages = ref<MessageItem[]>([])
const input = ref('')
const sending = ref(false)
const restoring = ref(false)
const transitioning = ref(false)
const restoreFailed = ref(false)
const conversationDrawer = ref(false)
const activeConversationId = ref('')
const activeDocumentId = ref('')
const documentTitle = ref('')
const conversationTitle = ref('')
const conversations = ref<ConversationSummary[]>([])
const conversationTotal = ref(0)
const conversationPage = ref(0)
const listLoading = ref(false)
const savedTurnCount = ref(0)
const recordLimitReached = computed(() => savedTurnCount.value >= 100)
const busy = computed(() => sending.value || restoring.value || transitioning.value)
const chatBody = ref<HTMLElement>()
const questionInput = ref<HTMLTextAreaElement>()
const suggestionOffset = ref(0)
const playingIndex = ref(-1)
const speechLoadingIndex = ref(-1)
const audioEl = new Audio()
let audioUrl: string | undefined
let speechRequest = 0
let mounted = true
let restoreRequest = 0
let listRequest = 0

const suggestions = [
  '高血压的宜吃食物有哪些？',
  '糖尿病的常见症状是什么？',
  '脑卒中有哪些食养指南？',
  '冠心病需要做哪些检查？',
  '高血压的忌吃食物有哪些？',
  '胃溃疡有哪些常见症状？',
]
const visibleSuggestions = computed(() => activeDocumentId.value
  ? ['这份资料对饮食有哪些建议？', '资料提到了哪些适用人群或注意事项？', '资料中与日常健康管理有关的内容有哪些？']
  : Array.from({ length: 3 }, (_, index) => suggestions[(suggestionOffset.value + index) % suggestions.length]!),
)

function changeSuggestions() {
  suggestionOffset.value = (suggestionOffset.value + 3) % suggestions.length
}

async function scrollToBottom() {
  await nextTick()
  chatBody.value?.scrollTo({ top: chatBody.value.scrollHeight, behavior: 'smooth' })
}

async function loadConversations(reset = false) {
  if (listLoading.value && !reset) return
  const request = ++listRequest
  const nextPage = reset ? 1 : conversationPage.value + 1
  listLoading.value = true
  try {
    const result = await conversationApi.list(nextPage)
    if (request !== listRequest || !mounted) return
    conversations.value = reset ? result.list : [...conversations.value, ...result.list.filter(item => !conversations.value.some(existing => existing._id === item._id))]
    conversationTotal.value = result.total
    conversationPage.value = result.page
  } catch {
    if (request === listRequest && mounted) ElMessage.warning('会话列表暂时无法加载，可稍后重试')
  } finally { if (request === listRequest) listLoading.value = false }
}

async function loadDocumentTitle(id: string, request: number) {
  if (!id) return
  try {
    const document = await knowledgeApi.document(id)
    if (request === restoreRequest && mounted) documentTitle.value = document.title
  } catch {
    if (request === restoreRequest && mounted) documentTitle.value = id
  }
}

function queryString(value: unknown) { return typeof value === 'string' ? value : '' }

async function restoreFromRoute() {
  const id = queryString(route.query.conversationId)
  const documentId = queryString(route.query.documentId)
  if (id && id === activeConversationId.value && !restoreFailed.value) return
  const request = ++restoreRequest
  stopSpeech()
  messages.value = []
  input.value = ''
  conversationTitle.value = ''
  documentTitle.value = ''
  restoreFailed.value = false
  savedTurnCount.value = 0
  activeConversationId.value = id
  activeDocumentId.value = id ? '' : documentId
  restoring.value = true
  try {
    if (id) {
      if (!/^[a-f\d]{24}$/i.test(id)) throw new Error('Invalid conversation')
      const result = await conversationApi.detail(id)
      if (request !== restoreRequest || !mounted) return
      conversationTitle.value = result.conversation.title
      activeDocumentId.value = result.conversation.documentId || ''
      messages.value = result.records.flatMap(record => [
        { role: 'user' as const, content: record.question },
        { role: 'assistant' as const, content: record.answer, detail: record.snapshot },
      ])
      savedTurnCount.value = result.records.length
    }
    await loadDocumentTitle(activeDocumentId.value, request)
    if (request === restoreRequest && mounted) await scrollToBottom()
  } catch {
    if (request === restoreRequest && mounted) {
      restoreFailed.value = true
      ElMessage.error('会话无法恢复，请重试或开始新会话')
    }
  } finally { if (request === restoreRequest) restoring.value = false }
}

async function chooseConversation(conversation: ConversationSummary) {
  if (busy.value) return
  conversationDrawer.value = false
  if (conversation._id === activeConversationId.value && !restoreFailed.value) return
  transitioning.value = true
  stopSpeech()
  try {
    await router.replace({ path: '/chat', query: { conversationId: conversation._id } })
  } finally { transitioning.value = false }
}

async function renameConversation(conversation: ConversationSummary) {
  if (busy.value) return
  try {
    const { value } = await ElMessageBox.prompt('为会话设置名称，最多 80 个字符', '重命名会话', {
      inputValue: conversation.title,
      inputValidator: (value: string) => Boolean(value.trim()) && value.trim().length <= 80,
      inputErrorMessage: '请输入 1～80 个字符',
      confirmButtonText: '保存', cancelButtonText: '取消',
    })
    const updated = await conversationApi.rename(conversation._id, value.trim())
    const row = conversations.value.find(item => item._id === conversation._id)
    if (row) Object.assign(row, updated)
    if (activeConversationId.value === updated._id) conversationTitle.value = updated.title
    ElMessage.success('会话名称已保存')
  } catch { /* 取消或请求失败时保留原名称，请求错误由 HTTP 拦截器提示。 */ }
}

async function send(text?: string) {
  const question = (text ?? input.value).trim()
  if (!question || busy.value || restoreFailed.value || recordLimitReached.value) return

  stopSpeech()
  messages.value.push({ role: 'user', content: question })
  messages.value.push({ role: 'assistant', content: '', loading: true })
  const assistant = messages.value[messages.value.length - 1]!
  input.value = ''
  sending.value = true
  await scrollToBottom()

  try {
    const res = await qaApi.ask(question, {
      ...(activeConversationId.value ? { conversationId: activeConversationId.value } : {}),
      ...(!activeConversationId.value && activeDocumentId.value ? { documentId: activeDocumentId.value } : {}),
    })
    if (!mounted) return
    assistant.content = res.answer
    assistant.detail = res
    const savedConversation = res.conversationId && /^[a-f\d]{24}$/i.test(res.conversationId)
    if (!savedConversation || !res.recordId) {
      assistant.saveWarning = '本轮回答未返回完整保存凭证，刷新后可能无法恢复。请刷新“我的会话”核对保存情况。'
    } else savedTurnCount.value++
    if (savedConversation && res.conversationId && !activeConversationId.value) {
      activeConversationId.value = res.conversationId
      conversationTitle.value = question
      await router.replace({ path: '/chat', query: { conversationId: res.conversationId } })
    }
    void loadConversations(true)
  } catch {
    assistant.content = '本轮问答未能完成，请稍后再试。您也可以在医学资料库中查找相关资料。'
    assistant.saveWarning = '无法确认本轮记录是否已保存，请先刷新“我的会话”核对记录后再重试。'
  } finally {
    assistant.loading = false
    sending.value = false
    if (mounted) {
      await scrollToBottom()
      questionInput.value?.focus()
    }
  }
}

function handleInputKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  void send()
}

function stopSpeech() {
  speechRequest++
  audioEl.pause()
  audioEl.removeAttribute('src')
  if (audioUrl) URL.revokeObjectURL(audioUrl)
  audioUrl = undefined
  playingIndex.value = -1
  speechLoadingIndex.value = -1
}

async function newConversation(documentId = activeDocumentId.value) {
  if (busy.value) return
  transitioning.value = true
  restoreRequest++
  stopSpeech()
  messages.value = []
  input.value = ''
  activeConversationId.value = ''
  activeDocumentId.value = documentId
  conversationTitle.value = ''
  restoreFailed.value = false
  savedTurnCount.value = 0
  if (!documentId) documentTitle.value = ''
  conversationDrawer.value = false
  try {
    await router.replace({ path: '/chat', query: documentId ? { documentId } : {} })
    await nextTick()
    questionInput.value?.focus()
  } finally { transitioning.value = false }
}

function speechTooLong(msg: MessageItem) { return msg.content.trim().length > 2000 }

async function playSpeech(msg: MessageItem, index: number) {
  if (!msg.content) return
  if (speechTooLong(msg)) {
    ElMessage.info('回答超过 2000 字符，暂不支持整段朗读；可以复制全文阅读。')
    return
  }
  if (playingIndex.value === index) {
    stopSpeech()
    return
  }
  stopSpeech()
  const request = speechRequest
  speechLoadingIndex.value = index
  try {
    const blob = await ttsApi.synthesize(msg.content)
    if (request !== speechRequest || !mounted) return
    audioUrl = URL.createObjectURL(blob)
    audioEl.src = audioUrl
    await audioEl.play()
    if (request === speechRequest) playingIndex.value = index
  } catch {
    if (request === speechRequest && mounted) {
      stopSpeech()
      ElMessage.error('语音暂时不可用，请稍后重试')
    }
  } finally {
    if (request === speechRequest) speechLoadingIndex.value = -1
  }
}

audioEl.onended = stopSpeech
onUnmounted(() => {
  mounted = false
  restoreRequest++
  listRequest++
  stopSpeech()
})

onBeforeRouteUpdate(to => {
  const targetId = queryString(to.query.conversationId)
  if (sending.value && (targetId !== activeConversationId.value
    || (!targetId && queryString(to.query.documentId) !== activeDocumentId.value))) {
    ElMessage.info('请等待本轮回答完成后再切换会话')
    return false
  }
})

watch(() => [route.query.conversationId, route.query.documentId], () => { void restoreFromRoute() }, { immediate: true })
onMounted(() => { void loadConversations(true) })

async function copyAnswer(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('回答已复制')
  } catch {
    ElMessage.warning('复制未完成，请手动选择文本')
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
  <section class="chat-page" aria-label="医学知识问答">
    <div class="conversation-bar">
      <button type="button" class="conversation-list-button" :disabled="busy" @click="conversationDrawer = true"><el-icon><Tickets /></el-icon>我的会话</button>
      <span class="conversation-name">{{ conversationTitle || (activeDocumentId ? '资料问答 · 新会话' : '新的医学知识问答') }}</span>
      <span v-if="restoring" class="restore-status" role="status">正在恢复…</span>
    </div>
    <div ref="chatBody" class="chat-body">
      <div class="conversation">
        <header class="welcome" :class="{ compact: messages.length }">
          <div class="section-kicker"><span></span> MEDICAL KNOWLEDGE</div>
          <h1>医学知识问答</h1>
          <p>从一个问题开始，探索有据可查的医学知识。</p>

          <div v-if="activeDocumentId" class="selected-document">
            <div><span class="selected-document-label">当前资料</span><button type="button" class="text-link" @click="router.push({ path: '/knowledge', query: { id: activeDocumentId } })">{{ documentTitle || activeDocumentId }} ↗</button><small>本会话仅检索这份资料的原文；更换资料需开启新会话。</small></div>
            <button type="button" class="document-exit" :disabled="busy" @click="newConversation('')">退出资料问答</button>
          </div>
          <p v-if="recordLimitReached" class="conversation-notice">本会话已达 100 轮，请开启新会话继续提问；已保存内容仍可查看。</p>
          <div v-if="restoreFailed" class="restore-error" role="alert">会话暂时无法读取。<button type="button" class="text-link" :disabled="busy" @click="restoreFromRoute">重试</button><button type="button" class="text-link" :disabled="busy" @click="newConversation('')">开始新会话</button></div>

          <div v-if="messages.length === 0 && !restoring && !restoreFailed" class="suggestion-card">
            <div class="suggestion-heading">
              <h2><el-icon><ChatLineRound /></el-icon>您可以试着问我</h2>
              <button v-if="!activeDocumentId" type="button" class="refresh-suggestions" @click="changeSuggestions">
                <el-icon><RefreshRight /></el-icon>换一组
              </button>
            </div>
            <div class="suggestion-list">
              <button v-for="suggestion in visibleSuggestions" :key="suggestion" type="button" :disabled="busy" @click="send(suggestion)">
                <span>{{ suggestion }}</span><span class="suggestion-arrow" aria-hidden="true">↗</span>
              </button>
            </div>
          </div>
        </header>

        <div class="messages" aria-live="polite" aria-relevant="additions text">
          <article v-for="(msg, i) in messages" :key="i" class="msg-row" :class="msg.role" :aria-busy="Boolean(msg.loading)">
            <div class="msg-heading">
              <span class="msg-avatar" aria-hidden="true"><el-icon><User v-if="msg.role === 'user'" /><FirstAidKit v-else /></el-icon></span>
              <span>{{ msg.role === 'user' ? '我' : 'MediBrain · 医学知识问答' }}</span>
            </div>
            <div class="msg-bubble">
              <div v-if="msg.loading" class="loading" role="status">
                <span class="loading-dots" aria-hidden="true"><i></i><i></i><i></i></span>
                <span>正在检索知识并整理回答…</span>
              </div>
              <template v-else>
                <div v-if="!msg.detail?.sections?.length" class="msg-text">{{ msg.content }}</div>
                <AnswerEvidence v-if="msg.detail" :detail="msg.detail" />
                <p v-if="msg.saveWarning" class="save-warning" role="alert">{{ msg.saveWarning }}</p>

                <div v-if="msg.detail?.entities?.length" class="msg-entities">
                  <template v-for="entity in msg.detail.entities" :key="entity.name">
                    <button v-if="isDisease(entity.type)" type="button" class="entity-chip clickable" @click="goDisease(entity.name)">{{ entity.name }}<span>查看疾病 ↗</span></button>
                    <span v-else class="entity-chip">{{ entity.name }} · {{ entity.type }}</span>
                  </template>
                </div>

                <div v-if="msg.detail?.vectorCandidates?.length" class="msg-vector">
                  <span class="vector-label">相关概念</span>
                  <template v-for="candidate in msg.detail.vectorCandidates.slice(0, 5)" :key="candidate.name">
                    <button v-if="isDisease(candidate.type)" type="button" class="text-link" @click="goDisease(candidate.name)">{{ candidate.name }}</button>
                    <span v-else>{{ candidate.name }}</span>
                  </template>
                </div>

              </template>
            </div>

            <div v-if="msg.role === 'assistant' && !msg.loading && msg.content" class="msg-actions">
              <button type="button" :class="{ active: playingIndex === i }" :disabled="speechLoadingIndex === i || speechTooLong(msg)" :title="speechTooLong(msg) ? '回答超过 2000 字符，暂不支持整段朗读' : '朗读完整回答'" @click="playSpeech(msg, i)">
                <el-icon :class="{ spinning: speechLoadingIndex === i }"><Loading v-if="speechLoadingIndex === i" /><VideoPause v-else-if="playingIndex === i" /><VideoPlay v-else /></el-icon>
                {{ speechLoadingIndex === i ? '正在合成' : playingIndex === i ? '停止朗读' : '朗读回答' }}
              </button>
              <button type="button" @click="copyAnswer(msg.content)"><el-icon><CopyDocument /></el-icon>复制回答</button>
              <span v-if="speechTooLong(msg)" class="speech-limit">超过 2000 字符，暂不支持整段朗读</span>
            </div>
          </article>
        </div>
      </div>
    </div>

    <footer class="composer">
      <div class="composer-inner">
        <div class="composer-toolbar">
          <button type="button" class="new-conversation" :disabled="busy" title="开启新会话，已保存的会话可从“我的会话”恢复" @click="newConversation()"><el-icon><Plus /></el-icon>新会话</button>
          <span class="knowledge-mode"><el-icon><FirstAidKit /></el-icon>{{ activeDocumentId ? '所选资料 · 原文检索' : '知识图谱 · 医学资料' }}</span>
          <span class="keyboard-hint">Enter 发送 · Shift + Enter 换行</span>
        </div>
        <div class="composer-box" :class="{ busy: sending }">
          <textarea ref="questionInput" v-model="input" aria-label="输入医学问题" :placeholder="recordLimitReached ? '本会话已达上限，请点击“新会话”…' : activeDocumentId ? '向当前资料提问，答案将附原文页码与段落…' : activeConversationId ? '继续提问，可承接上文的疾病主题…' : '输入您想了解的医学问题…'" rows="2" maxlength="2000" :disabled="busy || restoreFailed || recordLimitReached" @keydown="handleInputKeydown"></textarea>
          <div class="composer-controls"><span v-if="input.length > 1600" class="input-count">{{ input.length }}/2000</span><button type="button" class="send-button" :disabled="busy || restoreFailed || recordLimitReached || !input.trim()" :aria-label="sending ? '正在生成回答' : '发送问题'" :title="sending ? '正在生成回答' : '发送问题'" @click="send()"><el-icon :class="{ spinning: sending }"><Loading v-if="sending" /><Promotion v-else /></el-icon></button></div>
        </div>
        <p class="medical-note">回答仅供医学知识参考，不能替代专业诊断与治疗。</p>
      </div>
    </footer>
    <el-drawer v-model="conversationDrawer" title="我的会话" direction="ltr" size="360px" class="conversation-drawer">
      <div class="drawer-toolbar"><button type="button" class="new-conversation" :disabled="busy" @click="newConversation()"><el-icon><Plus /></el-icon>新会话</button><button type="button" class="text-link" :disabled="listLoading" @click="loadConversations(true)">刷新列表</button></div>
      <p class="drawer-note">会话首次获得回答后自动保存，支持恢复并继续追问。</p>
      <div v-for="conversation in conversations" :key="conversation._id" class="saved-conversation" :class="{ selected: conversation._id === activeConversationId }">
        <button type="button" class="saved-conversation-open" :disabled="busy" @click="chooseConversation(conversation)"><strong>{{ conversation.title }}</strong><span>{{ conversation.documentId ? '资料问答' : '知识问答' }} · {{ new Date(conversation.updatedAt).toLocaleDateString('zh-CN') }}</span></button>
        <button type="button" class="rename-button" :disabled="busy" :aria-label="`重命名 ${conversation.title}`" title="重命名会话" @click="renameConversation(conversation)"><el-icon><EditPen /></el-icon></button>
      </div>
      <el-empty v-if="!listLoading && !conversations.length" description="还没有保存的会话" :image-size="80" />
      <button v-if="conversations.length < conversationTotal || listLoading" type="button" class="load-more" :disabled="listLoading" @click="loadConversations()">{{ listLoading ? '正在加载…' : '加载更多会话' }}</button>
    </el-drawer>
  </section>
</template>

<style scoped>
.chat-page { width: 100%; height: 100%; min-height: 0; display: flex; flex-direction: column; background: #fff; color: var(--mb-text); }
.conversation-bar { display: flex; align-items: center; gap: 14px; min-height: 46px; padding: 8px 30px; border-bottom: 1px solid #f0eeeb; flex-shrink: 0; }
.conversation-list-button { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; padding: 5px 0; border: none; background: none; color: var(--mb-accent); font-size: 12px; }
.conversation-list-button .el-icon { font-size: 16px; }
.conversation-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--mb-muted); font-size: 12px; }
.restore-status { margin-left: auto; flex-shrink: 0; color: var(--mb-muted); font-size: 11px; }
.selected-document { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; border-left: 3px solid #d39564; background: #fff8f1; padding: 12px 15px; margin: 16px 0 20px; border-radius: 5px; }
.selected-document > div { min-width: 0; }
.selected-document-label { display: block; color: #97663e; font-size: 10px; margin-bottom: 4px; }
.selected-document .text-link { font-size: 13px; line-height: 1.8; overflow-wrap: anywhere; }
.selected-document small { display: block; margin-top: 5px; color: var(--mb-muted); font-size: 11px; line-height: 1.7; }
.document-exit { flex-shrink: 0; border: none; background: none; padding: 4px 0; color: #8c6b50; font-size: 11px; }
.conversation-notice { margin: 12px 0; color: var(--mb-muted); font-size: 11px; }
.restore-error { display: flex; flex-wrap: wrap; gap: 12px; margin: 18px 0; padding: 12px; border: 1px solid #edc9a6; border-radius: 6px; font-size: 13px; }
.save-warning { margin: 12px 0 0; padding: 9px 12px; border-left: 3px solid #d39564; border-radius: 4px; background: #fff3e0; color: #8a5d30; font-size: 12px; line-height: 1.8; }
.drawer-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 12px; }
.drawer-note { margin: 16px 0; font-size: 11px; line-height: 1.8; color: var(--mb-muted); }
.saved-conversation { display: flex; align-items: center; margin: 0 0 8px; border: 1px solid #eeeae5; border-radius: 7px; background: #fff; }
.saved-conversation.selected { background: #fff7ef; border-color: #edc9a6; }
.saved-conversation-open { display: flex; flex-direction: column; gap: 6px; min-width: 0; flex: 1; text-align: left; padding: 12px; border: 0; background: transparent; }
.saved-conversation-open strong { display: block; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--mb-text); font-size: 13px; font-weight: 500; }
.saved-conversation-open span { color: var(--mb-muted); font-size: 11px; }
.rename-button { flex-shrink: 0; padding: 10px; border: none; background: none; color: var(--mb-muted); }
.rename-button:hover { color: var(--mb-accent); }
.load-more { width: 100%; margin-top: 8px; padding: 10px; border: 1px solid #eeeae5; border-radius: 5px; background: #faf9f7; color: var(--mb-muted); font-size: 12px; }
:global(.conversation-drawer) { max-width: 92vw; }
.chat-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.conversation { width: 100%; max-width: 1064px; margin: 0 auto; padding: 46px 32px 24px; }
.welcome { padding-bottom: 28px; }
.section-kicker { display: flex; align-items: center; gap: 7px; margin-bottom: 12px; color: var(--mb-accent); font-size: 10px; font-weight: 600; letter-spacing: 1.8px; }
.section-kicker > span { width: 16px; height: 2px; background: currentColor; }
.welcome h1 { margin: 0; font-size: 25px; font-weight: 650; line-height: 1.5; letter-spacing: .5px; }
.welcome > p { margin: 9px 0 26px; color: var(--mb-muted); font-size: 14px; line-height: 1.8; }
.welcome.compact { padding-bottom: 16px; }
.welcome.compact .section-kicker { display: none; }
.welcome.compact h1 { font-size: 22px; }
.welcome.compact > p { margin-bottom: 0; }
.suggestion-card { width: 100%; max-width: 660px; border: 1px solid #edc9a6; border-radius: 11px; padding: 20px 24px 17px; }
.suggestion-heading { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 12px; }
.suggestion-heading h2 { display: flex; align-items: center; gap: 9px; margin: 0; font-size: 16px; font-weight: 500; }
.suggestion-heading h2 .el-icon { color: var(--mb-accent); font-size: 21px; }
button { font: inherit; cursor: pointer; }
.refresh-suggestions { display: flex; align-items: center; gap: 4px; padding: 4px 0; background: none; border: none; color: var(--mb-muted); font-size: 12px; white-space: nowrap; }
.refresh-suggestions:hover { color: var(--mb-accent); }
.suggestion-list { display: flex; flex-direction: column; gap: 2px; }
.suggestion-list > button { display: flex; align-items: center; justify-content: space-between; gap: 16px; width: 100%; padding: 9px 0; border: none; background: none; color: var(--mb-accent); text-align: left; font-size: 14px; line-height: 1.6; }
.suggestion-list > button:hover { color: #8e3e17; }
.suggestion-arrow { opacity: .5; font-size: 17px; }
.suggestion-list > button:hover .suggestion-arrow { opacity: 1; }
.messages { display: flex; flex-direction: column; }
.msg-row { margin: 20px 0 28px; min-width: 0; }
.msg-heading { display: flex; align-items: center; gap: 9px; margin-bottom: 9px; color: var(--mb-muted); font-size: 12px; }
.msg-avatar { display: grid; place-items: center; width: 26px; height: 26px; color: var(--mb-accent); background: var(--mb-accent-soft); border-radius: 8px; font-size: 18px; }
.msg-row.user { align-self: flex-end; max-width: 80%; }
.user .msg-heading { flex-direction: row-reverse; }
.user .msg-avatar { background: none; }
.msg-bubble { border-radius: 10px; padding: 20px 24px; }
.user .msg-bubble { background: var(--mb-accent); color: #fff; border-top-right-radius: 3px; padding: 12px 20px; }
.assistant .msg-bubble { margin-left: 35px; background: #f6f7f8; border-top-left-radius: 3px; }
.msg-text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 15px; line-height: 1.95; }
.user .msg-text { line-height: 1.7; }
.msg-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 16px; font-size: 11px; }
.grounding-label { display: inline-flex; align-items: center; gap: 5px; color: #527559; }
.grounding-label > span { width: 5px; height: 5px; border-radius: 50%; background: #6e9677; }
.dimension-label { padding: 2px 7px; border-radius: 4px; color: var(--mb-muted); background: #eceef0; }
.msg-entities { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.entity-chip { display: inline-flex; align-items: center; gap: 7px; padding: 4px 8px; border: 1px solid #e5e7e9; border-radius: 5px; background: #fff; color: #62666e; font-size: 11px; line-height: 1.7; }
.entity-chip.clickable { color: var(--mb-accent); border-color: #efd7c5; }
.entity-chip > span { opacity: .7; font-size: 10px; }
.entity-chip.clickable:hover { background: var(--mb-accent-soft); }
.msg-vector { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; font-size: 12px; }
.vector-label { color: var(--mb-muted); }
.text-link { display: inline; border: none; padding: 0; background: none; color: var(--mb-accent); text-align: left; font-size: inherit; line-height: inherit; }
.text-link:hover, .reference-record a:hover { text-decoration: underline; }
.msg-sources { margin-top: 16px; border-top: 1px solid #e5e7e9; padding-top: 12px; color: #636871; font-size: 12px; line-height: 1.8; }
.msg-sources summary { cursor: pointer; color: #555b64; font-weight: 500; }
.msg-sources summary > span { margin-left: 6px; color: var(--mb-muted); font-weight: 400; font-size: 11px; }
.source-record { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; overflow-wrap: anywhere; }
.source-record > strong { color: var(--mb-accent); font-weight: 500; }
.source-record > span { flex: 1 1 70%; }
.reference-record { padding-top: 10px; overflow-wrap: anywhere; }
.reference-title { font-size: 13px; }
.reference-record > div { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 2px; font-size: 11px; color: var(--mb-muted); }
.reference-record a { color: var(--mb-accent); text-decoration: none; }
.review-note { margin-top: 10px; color: var(--mb-muted); font-size: 11px; }
.msg-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 18px; margin: 10px 0 0 35px; }
.msg-actions > button { display: inline-flex; align-items: center; gap: 5px; background: none; border: none; padding: 4px 0; color: var(--mb-muted); font-size: 11px; }
.msg-actions > button:hover, .msg-actions > button.active { color: var(--mb-accent); }
.msg-actions .el-icon { font-size: 15px; }
.speech-limit { color: var(--mb-muted); font-size: 10px; line-height: 1.7; }
.loading { display: flex; align-items: center; gap: 12px; min-height: 28px; color: var(--mb-muted); font-size: 13px; }
.loading-dots { display: flex; gap: 4px; }
.loading-dots > i { width: 5px; height: 5px; border-radius: 50%; background: var(--mb-accent); animation: bounce 1.2s infinite; }
.loading-dots > i:nth-child(2) { animation-delay: .2s; }
.loading-dots > i:nth-child(3) { animation-delay: .4s; }
.composer { flex-shrink: 0; background: #fff; padding: 10px 32px 17px; }
.composer-inner { width: 100%; max-width: 1000px; margin: 0 auto; }
.composer-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; min-height: 34px; margin-bottom: 9px; }
.new-conversation { display: inline-flex; align-items: center; gap: 5px; border: 1px solid #eeeae5; background: #f7f7f6; color: #656970; padding: 7px 12px; border-radius: 5px; font-size: 12px; }
.new-conversation:hover { color: var(--mb-accent); border-color: #edc9a6; background: var(--mb-accent-soft); }
.knowledge-mode { display: inline-flex; align-items: center; gap: 5px; padding: 6px 10px; color: var(--mb-accent); background: #fff7ef; border-radius: 5px; font-size: 11px; }
.keyboard-hint { margin-left: auto; color: #8a8e95; font-size: 10px; }
.composer-box { position: relative; border: 1px solid #e5bf9d; border-radius: 8px; background: #fff; transition: border-color .18s, box-shadow .18s; }
.composer-box:focus-within { border-color: var(--mb-accent); box-shadow: 0 0 0 3px #c552200b; }
.composer-box textarea { display: block; width: 100%; min-height: 70px; max-height: 160px; padding: 15px 18px 8px; border: none; outline: none; background: none; color: var(--mb-text); font: inherit; font-size: 14px; line-height: 1.7; resize: none; border-radius: 8px; }
.composer-box textarea::placeholder { color: #9499a1; }
.composer-box textarea:disabled { cursor: wait; }
.composer-controls { display: flex; justify-content: flex-end; align-items: center; gap: 10px; padding: 0 10px 10px; }
.input-count { color: var(--mb-muted); font-size: 10px; }
.send-button { display: grid; place-items: center; width: 32px; height: 30px; border: none; border-radius: 6px; background: var(--mb-accent); color: #fff; font-size: 19px; transition: background .18s; }
.send-button:hover:not(:disabled) { background: #a9441a; }
.send-button:disabled { background: #e8c1a8; cursor: default; }
button:disabled { cursor: default; opacity: .65; }
button:focus-visible, a:focus-visible, summary:focus-visible { outline: 2px solid var(--mb-accent); outline-offset: 4px; border-radius: 3px; }
.medical-note { margin: 11px 0 0; text-align: center; color: #8b8e94; font-size: 11px; line-height: 1.6; }
.spinning { animation: spin 1s linear infinite; }
@keyframes bounce { 0%, 80%, 100% { transform: translateY(0); opacity: .4; } 40% { transform: translateY(-4px); opacity: 1; } }
@keyframes spin { to { transform: rotate(360deg); } }
@media (min-width: 1600px) { .conversation { padding-top: 54px; } }
@media (max-width: 760px) {
  .conversation-bar { padding: 8px 20px; }
  .conversation { padding: 28px 20px 16px; }
  .welcome h1 { font-size: 23px; }
  .suggestion-card { padding: 16px 18px; }
  .composer { padding: 8px 20px 13px; }
  .keyboard-hint { display: none; }
  .msg-bubble { padding: 15px 17px; }
  .assistant .msg-bubble { margin-left: 0; }
  .msg-actions { margin-left: 0; }
}
@media (max-width: 480px) {
  .conversation-bar { padding: 7px 16px; }
  .selected-document { flex-direction: column; gap: 6px; padding: 10px 12px; }
  .conversation { padding: 22px 16px 12px; }
  .welcome > p { margin-bottom: 20px; font-size: 12px; }
  .section-kicker { font-size: 9px; }
  .suggestion-heading h2 { font-size: 14px; }
  .suggestion-list > button { font-size: 13px; }
  .msg-row.user { max-width: 90%; }
  .msg-text { font-size: 14px; }
  .composer { padding: 7px 16px max(12px, env(safe-area-inset-bottom)); }
  .medical-note { font-size: 10px; }
  .composer-toolbar { gap: 7px; }
  .knowledge-mode { font-size: 10px; }
}
@media (prefers-reduced-motion: reduce) { .spinning, .loading-dots > i { animation: none; } .composer-box, .send-button { transition: none; } }
</style>
