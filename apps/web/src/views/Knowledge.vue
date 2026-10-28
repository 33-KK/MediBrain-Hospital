<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { knowledgeApi, type KnowledgeDocument, type KnowledgeReference } from '@/api'

const route = useRoute()
const router = useRouter()
const keyword = ref('')
const page = ref(1)
const total = ref(0)
const list = ref<KnowledgeReference[]>([])
const stats = ref<Record<string, number>>({})
const selected = ref<KnowledgeDocument>()
const loading = ref(false)
const reading = ref(false)
const targetParagraph = ref(0)
const targetFound = computed(() => selected.value?.paragraphs?.some(item => item.paragraph === targetParagraph.value))
const reader = ref<HTMLElement>()
let readVersion = 0
let searchVersion = 0
let mounted = true

async function search(reset = false) {
  if (reset) page.value = 1
  const version = ++searchVersion
  loading.value = true
  try {
    const result = await knowledgeApi.search(keyword.value, page.value)
    if (version === searchVersion && mounted) {
      list.value = result.list
      total.value = result.total
    }
  } finally { if (version === searchVersion) loading.value = false }
}

function read(id: string, pdfPage = 1) {
  if (route.query.id === id && positiveQuery(route.query.page, 1) === pdfPage && !route.query.paragraph) {
    void readFromRoute()
    return
  }
  void router.replace({ query: { id, page: String(pdfPage) } })
}

function positiveQuery(value: unknown, fallback: number) {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : 0
  return Number.isSafeInteger(number) && number > 0 ? number : fallback
}

async function readFromRoute() {
  const version = ++readVersion
  const id = typeof route.query.id === 'string' ? route.query.id : ''
  if (!id) { selected.value = undefined; reading.value = false; return }
  const pdfPage = positiveQuery(route.query.page, 1)
  const paragraph = positiveQuery(route.query.paragraph, 0)
  reading.value = true
  selected.value = undefined
  targetParagraph.value = paragraph
  try {
    const document = await knowledgeApi.document(id, pdfPage)
    if (version === readVersion && mounted) {
      selected.value = document
      await nextTick()
      if (version === readVersion && paragraph) {
        reader.value?.querySelector(`#source-paragraph-${paragraph}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
  } catch {
    if (version === readVersion && mounted) ElMessage.error('资料加载失败，请稍后重试')
  } finally { if (version === readVersion) reading.value = false }
}

watch(() => [route.query.id, route.query.page, route.query.paragraph], () => { void readFromRoute() }, { immediate: true })
onUnmounted(() => { mounted = false; readVersion++; searchVersion++ })

onMounted(async () => {
  try {
    const tasks: Promise<unknown>[] = [search(), knowledgeApi.stats().then(result => { if (mounted) stats.value = result })]
    await Promise.all(tasks)
  } catch { ElMessage.error('资料库暂时不可用，请稍后重试') }
})
</script>

<template>
  <div class="knowledge-page">
    <div class="library-header">
      <div>
        <h2>医学资料库</h2>
        <p>{{ stats.documents ?? '—' }} 份资料 · {{ stats.englishSummaries ?? '—' }} 条英文摘要 · {{ stats.chinesePdfs ?? '—' }} 份中文 PDF · {{ stats.pdfPages ?? '—' }} 页原文</p>
      </div>
      <el-tag type="warning" effect="plain">医学适用性待专业复核</el-tag>
    </div>
    <el-form class="search-form" @submit.prevent="search(true).catch(() => ElMessage.error('检索失败'))">
      <el-input v-model="keyword" maxlength="200" clearable placeholder="输入疾病名或英文关键词，例如：高血压、脑卒中、Asthma" />
      <el-button type="primary" native-type="submit" :loading="loading">检索资料</el-button>
    </el-form>
    <div class="library-columns">
      <section v-loading="loading" class="document-list">
        <p class="result-count">共 {{ total }} 份相关资料</p>
        <button v-for="item in list" :key="item.id" class="document-item" :class="{ active: selected?.id === item.id }" @click="read(item.id)">
          <strong>{{ item.title }}</strong>
          <span>{{ item.publisher }} · {{ item.version }}</span>
          <small>{{ item.language === 'zh' ? '中文' : '英文' }}<template v-if="item.pageCount"> · {{ item.pageCount }} 页</template></small>
        </button>
        <el-empty v-if="!loading && !list.length" description="没有匹配资料，可尝试英文关键词" />
        <el-pagination v-if="total > 20" v-model:current-page="page" :total="total" :page-size="20" layout="prev, pager, next" @current-change="search().catch(() => ElMessage.error('检索失败'))" />
      </section>
      <section ref="reader" v-loading="reading" class="document-reader">
        <template v-if="selected">
          <h3>{{ selected.title }}</h3>
          <p class="source-meta">{{ selected.publisher }} · {{ selected.version }} · {{ selected.language === 'zh' ? '中文' : '英文原文' }}</p>
          <div class="document-actions"><el-button type="primary" @click="router.push({ path: '/chat', query: { documentId: selected.id } })">基于此资料提问</el-button><el-link :href="selected.url" target="_blank" rel="noopener noreferrer" type="primary">打开官方原文</el-link></div>
          <p v-if="selected.textKind === 'adapted-draft'" class="reading-note">以下为中文释义草稿，非官方原文，尚未完成专业复核。</p>
          <p v-else-if="selected.pageCount" class="reading-note">以下为 PDF 按页提取的文字。表格、单位、脚注及适用条件请对照官方 PDF 核验。</p>
          <p v-else class="reading-note">英文摘要尚未完成中文翻译及本地适用性复核。相关主题标签不代表疾病实体等价。</p>
          <div v-if="selected.pageCount" class="page-controls">
            <el-button :disabled="reading || selected.page === 1" @click="read(selected.id, (selected.page || 1) - 1)">上一页</el-button>
            <span>PDF 第 {{ selected.page }} / {{ selected.pageCount }} 页</span>
            <el-button :disabled="reading || selected.page === selected.pageCount" @click="read(selected.id, (selected.page || 1) + 1)">下一页</el-button>
          </div>
          <div v-if="selected.paragraphs?.length" class="source-paragraphs">
            <p v-if="targetParagraph && targetFound" class="location-note">已定位至{{ selected.page ? `第 ${selected.page} 页` : '摘要' }}第 {{ targetParagraph }} 段。段落编号以当前页提取文字为准。</p>
            <p v-else-if="targetParagraph" class="location-note">当前资料中未找到所引段落，请核对官方原文及版本。</p>
            <p v-for="paragraph in selected.paragraphs" :id="`source-paragraph-${paragraph.paragraph}`" :key="paragraph.paragraph" class="source-paragraph" :class="{ highlighted: paragraph.paragraph === targetParagraph }"><span class="paragraph-number">{{ paragraph.paragraph }}</span><span class="paragraph-text">{{ paragraph.text }}</span></p>
          </div>
          <pre v-else-if="selected.contentText" class="source-text">{{ selected.contentText }}</pre>
          <el-empty v-else description="本页没有可提取文字，请查看官方原文" />
          <p class="source-meta">来源署名：{{ selected.attribution }}</p>
          <details class="source-details">
            <summary>适用范围与来源信息</summary>
            <p>{{ selected.contentScope }}</p>
            <p>{{ selected.reuse }}</p>
            <p class="hash">原件 SHA-256：{{ selected.originalSha256 }}</p>
          </details>
        </template>
        <el-empty v-else description="从左侧选择资料，查看原文与出处" />
      </section>
    </div>
  </div>
</template>

<style scoped>
.knowledge-page { background: #fff; padding: 24px; border-radius: 8px; }
.library-header { display: flex; justify-content: space-between; gap: 16px; align-items: center; }
h2 { margin: 0 0 10px; color: #303133; }
.library-header p, .source-meta, .result-count { font-size: 13px; color: #606266; }
.search-form { display: flex; gap: 12px; margin: 20px 0; }
.library-columns { display: grid; grid-template-columns: minmax(250px, 34%) minmax(0, 1fr); gap: 24px; }
.document-list { border-right: 1px solid #ebeef5; padding-right: 20px; }
.document-item { display: flex; flex-direction: column; gap: 8px; width: 100%; padding: 14px; background: #fff; border: 1px solid #ebeef5; border-radius: 6px; text-align: left; cursor: pointer; margin-bottom: 10px; color: #303133; }
.document-item.active, .document-item:hover { background: #fff7ef; border-color: #e8bb96; }
.document-item span, .document-item small { color: #606266; font-size: 12px; }
.document-reader { min-width: 0; }
.document-reader h3 { margin-top: 8px; }
.document-actions { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; margin: 14px 0; }
.source-paragraph { display: flex; gap: 12px; padding: 10px 12px 10px 0; border-radius: 5px; margin: 5px 0; line-height: 1.85; color: #303133; scroll-margin-top: 100px; }
.paragraph-number { flex: 0 0 25px; padding-top: 3px; color: #aaa19a; text-align: right; font-size: 11px; }
.paragraph-text { white-space: pre-wrap; overflow-wrap: anywhere; min-width: 0; }
.source-paragraph.highlighted { background: #fff0df; box-shadow: inset 3px 0 #d39564; }
.location-note { color: #986b3f; font-size: 12px; line-height: 1.7; }
.reading-note { padding: 12px; background: #fdf6ec; border-radius: 5px; font-size: 13px; line-height: 1.6; color: #8b651c; }
.source-text { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; line-height: 1.85; color: #303133; }
.page-controls { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 13px; margin: 16px 0; }
.source-details { font-size: 12px; line-height: 1.7; color: #606266; }
.hash { overflow-wrap: anywhere; }
@media (max-width: 1000px) { .library-columns { grid-template-columns: 1fr; } .document-list { border-right: 0; padding: 0; } .library-header { align-items: flex-start; flex-direction: column; } }
@media (max-width: 600px) { .knowledge-page { padding: 16px; } .search-form { flex-direction: column; } .source-paragraph { gap: 8px; font-size: 14px; } .page-controls { flex-wrap: wrap; } }
</style>
