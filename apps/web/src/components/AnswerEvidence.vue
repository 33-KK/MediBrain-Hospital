<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import type { DocumentEvidence, QaResponse } from '@/api'

const props = defineProps<{ detail: QaResponse }>()
const router = useRouter()
const graphDetails = ref<HTMLDetailsElement>()

function openDocument(source: DocumentEvidence) {
  void router.push({ path: '/knowledge', query: {
    id: source.documentId,
    ...(source.page ? { page: String(source.page) } : {}),
    paragraph: String(source.paragraph),
  } })
}

function openSource(id: string) {
  const document = props.detail.documentEvidence?.find(item => item.id === id)
  if (document) return openDocument(document)
  if (!props.detail.sources?.some(item => item.id === id)) return
  if (graphDetails.value) {
    graphDetails.value.open = true
    graphDetails.value.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }
}

function hasSource(id: string) {
  return props.detail.sources?.some(item => item.id === id)
    || props.detail.documentEvidence?.some(item => item.id === id)
}

function safeUrl(url: string) {
  try {
    const parsed = new URL(url)
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : undefined
  } catch { return undefined }
}

function sourceMode() {
  if (props.detail.grounding?.mode === 'document-excerpts') return props.detail.documentEvidence?.length ? '基于所选资料的原文摘录' : '所选资料未获得匹配摘录'
  if (props.detail.grounding?.mode === 'reference-library') return props.detail.references?.length ? '相关资料检索' : '未找到相关资料'
  if (props.detail.graphMatched) return '基于知识图谱'
  return '未获得可核验依据'
}
</script>

<template>
  <div class="answer-evidence">
    <div v-if="detail.sections?.length" class="answer-sections">
      <section v-for="(section, sectionIndex) in detail.sections" :key="sectionIndex">
        <h3>{{ section.title }}</h3>
        <ul>
          <li v-for="(item, itemIndex) in section.items" :key="itemIndex">
            <span class="fact-text">{{ item.text }}</span>
            <template v-for="id in item.sourceIds" :key="id">
              <button v-if="hasSource(id)" type="button" class="source-chip" :aria-label="`查看依据 ${id}`" @click="openSource(id)">[{{ id }}]</button>
              <span v-else class="source-unavailable">[{{ id }}]</span>
            </template>
          </li>
        </ul>
      </section>
    </div>

    <p v-if="detail.context?.inheritedEntities.length" class="context-note">承接上文主题：{{ detail.context.inheritedEntities.join('、') }}<span v-if="detail.resolvedQuestion"> · 本轮检索：{{ detail.resolvedQuestion }}</span></p>
    <p v-if="detail.context?.needsClarification" class="context-note clarification">请补充疾病名称或具体问题，以便检索依据。</p>
    <div class="answer-meta"><span class="grounding-label"><i></i>{{ sourceMode() }}</span><span v-if="detail.dimension" class="dimension-label">{{ detail.dimension }}</span><span v-if="detail.vectorMatched" class="dimension-label">语义检索</span></div>
    <p v-if="detail.grounding && detail.grounding.omitted > 0" class="context-note">{{ detail.grounding.mode === 'document-excerpts' ? `另有至少 ${detail.grounding.omitted} 个匹配段落未展示，请打开资料核对完整上下文。` : `另有至少 ${detail.grounding.omitted} 条图谱记录未展示，可在疾病详情中查看。` }}</p>
    <p v-if="detail.knowledgeUnavailable" class="context-note clarification">部分知识检索暂时不可用，本轮回答可能不完整，请稍后重试。</p>

    <details v-if="detail.sources?.length" ref="graphDetails" class="evidence-details">
      <summary>图谱回答依据 <span>{{ detail.sources.length }} 条记录</span></summary>
      <div v-for="source in detail.sources" :key="source.id" class="source-record"><strong>[{{ source.id }}]</strong><span>{{ source.text }}</span></div>
      <p class="review-note">图谱记录尚未完成医学专业审核。</p>
    </details>

    <details v-if="detail.documentEvidence?.length" class="evidence-details" open>
      <summary>原文摘录与定位 <span>{{ detail.documentEvidence.length }} 条</span></summary>
      <article v-for="source in detail.documentEvidence" :key="source.id" class="document-evidence">
        <button type="button" class="text-link evidence-title" @click="openDocument(source)">[{{ source.id }}] {{ source.title }} · {{ source.page ? `第 ${source.page} 页` : '摘要' }} · 第 {{ source.paragraph }} 段 ↗</button>
        <blockquote>{{ source.text }}</blockquote>
        <div class="excerpt-meta"><span>{{ source.language === 'zh' ? '中文' : '原文语言：' + source.language }}{{ source.textKind === 'adapted-draft' ? ' · 释义草稿，非官方原文' : '' }}</span><a v-if="safeUrl(source.url)" :href="safeUrl(source.url)" target="_blank" rel="noopener noreferrer">官方原文 ↗</a></div>
      </article>
      <p class="review-note">摘录仅反映所选资料的文字，不构成完整诊疗建议。PDF 表格、单位及适用条件请核对原件。</p>
    </details>

    <details v-if="detail.references?.length" class="evidence-details" :open="detail.grounding?.mode === 'reference-library'">
      <summary>相关医学资料 <span>{{ detail.references.length }} 份</span></summary>
      <div v-for="item in detail.references" :key="item.id" class="reference-record">
        <button type="button" class="text-link evidence-title" @click="router.push({ path: '/knowledge', query: { id: item.id } })">{{ item.title }}</button>
        <div class="excerpt-meta"><span>{{ item.publisher }} · {{ item.version }}</span><a v-if="safeUrl(item.url)" :href="safeUrl(item.url)" target="_blank" rel="noopener noreferrer">官方原文 ↗</a></div>
      </div>
      <p class="review-note">{{ detail.grounding?.mode === 'graph-facts' ? '这些资料仅供补充阅读，不作为上方图谱事实的直接证明。' : '资料保留原始出处，医学适用性仍待专业复核。' }}</p>
    </details>
    <p v-if="detail.reviewEntities?.length" class="context-note clarification">待复核实体：{{ detail.reviewEntities.join('、') }}；这些实体的记录未用于回答。</p>
  </div>
</template>

<style scoped>
.answer-sections section + section { margin-top: 20px; }
.answer-sections h3 { margin: 0 0 9px; color: var(--mb-text, #303133); font-size: 16px; line-height: 1.7; }
.answer-sections ul { margin: 0; padding-left: 21px; }
.answer-sections li { padding: 3px 0; line-height: 1.95; font-size: 15px; overflow-wrap: anywhere; }
.fact-text { white-space: pre-wrap; }
.source-chip { display: inline; padding: 1px 5px; margin-left: 5px; border: 1px solid #edc9a6; border-radius: 4px; color: var(--mb-accent, #c55220); background: #fff8f1; cursor: pointer; font: inherit; font-size: 11px; vertical-align: middle; }
.source-unavailable { color: #909399; font-size: 11px; margin-left: 5px; }
.answer-meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 14px; font-size: 11px; }
.grounding-label { display: flex; align-items: center; gap: 5px; color: #527559; }
.grounding-label i { width: 5px; height: 5px; border-radius: 50%; background: #6e9677; }
.dimension-label { padding: 2px 7px; border-radius: 4px; background: #eceef0; color: #636871; }
.context-note { margin: 12px 0 0; padding: 8px 10px; background: #fff8ef; border-radius: 5px; color: #8a5d30; font-size: 12px; line-height: 1.8; overflow-wrap: anywhere; }
.clarification { background: #fff3e0; }
.evidence-details { margin-top: 16px; border-top: 1px solid #e5e7e9; padding-top: 12px; color: #636871; font-size: 12px; line-height: 1.8; }
.evidence-details summary { cursor: pointer; color: #555b64; font-weight: 500; }
.evidence-details summary > span { margin-left: 6px; font-size: 11px; font-weight: 400; color: #8b8e94; }
.source-record { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; overflow-wrap: anywhere; }
.source-record strong { color: var(--mb-accent, #c55220); }
.source-record > span { flex: 1 1 70%; }
.document-evidence, .reference-record { margin-top: 12px; overflow-wrap: anywhere; }
.text-link, .excerpt-meta a { border: 0; padding: 0; background: none; color: var(--mb-accent, #c55220); font: inherit; text-align: left; text-decoration: none; cursor: pointer; }
.text-link:hover, .excerpt-meta a:hover { text-decoration: underline; }
.evidence-title { font-size: 13px; line-height: 1.8; }
blockquote { margin: 8px 0; border-left: 2px solid #e6bf9d; padding: 5px 12px; background: #fff; white-space: pre-wrap; line-height: 1.9; }
.excerpt-meta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 3px; color: #8b8e94; font-size: 11px; }
.review-note { margin: 10px 0 0; color: #8b8e94; font-size: 11px; line-height: 1.8; }
button:focus-visible, a:focus-visible, summary:focus-visible { outline: 2px solid var(--mb-accent, #c55220); outline-offset: 3px; }
@media (max-width: 480px) { .answer-sections li { font-size: 14px; } }
</style>
