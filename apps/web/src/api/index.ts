import http from './http'

export interface LoginPayload {
  username: string
  password: string
}

export interface RegisterPayload {
  username: string
  password: string
}

export interface UserInfo {
  userId?: string
  username: string
}

export const authApi = {
  login: (data: LoginPayload) => http.post('/auth/login', data),
  register: (data: RegisterPayload) => http.post('/auth/register', data),
  profile: () => http.get('/auth/profile') as unknown as Promise<UserInfo>,
}

export interface QaResponse {
  answer: string
  entities: { name: string; type: string }[]
  dimension: string | null
  sources: {
    id: string
    subject: string
    entity: string
    relation: string
    label: string
    direction: 'outgoing' | 'incoming'
    text: string
  }[]
  grounding?: { mode: 'graph-facts' | 'reference-library' | 'document-excerpts'; modelAccepted: boolean; omitted: number }
  conversationId?: string
  recordId?: string
  resolvedQuestion?: string
  context?: { inheritedEntities: string[]; needsClarification: boolean }
  sections?: { title: string; items: { text: string; sourceIds: string[] }[] }[]
  documentEvidence?: DocumentEvidence[]
  references?: KnowledgeReference[]
  provider: string
  graphMatched: boolean
  knowledgeUnavailable?: boolean
  reviewEntities?: string[]
  vectorMatched?: boolean
  vectorCandidates?: { name: string; type: string; score: number }[]
}

export const qaApi = {
  ask: (question: string, options: { conversationId?: string; documentId?: string } = {}) =>
    http.post('/qa/ask', { question, ...options }) as Promise<QaResponse>,
  search: (kw: string) =>
    http.get('/qa/search', { params: { kw } }) as Promise<{ name: string; label: string; desc?: string }[]>,
  disease: (name: string) =>
    http.get('/qa/disease', { params: { name } }) as Promise<any>,
}

export interface KnowledgeReference {
  id: string
  title: string
  kind: string
  language: string
  publisher: string
  url: string
  version: string
  topicsZh: string[]
  pageCount: number
  reviewStatus: string
}

export interface KnowledgeDocument extends KnowledgeReference {
  contentText: string
  page: number | null
  textKind: string
  attribution: string
  contentScope: string
  reuse: string
  originalSha256: string
  extractionStatus?: string
  paragraphs?: { paragraph: number; text: string }[]
}

export interface DocumentEvidence {
  id: string
  documentId: string
  title: string
  page: number | null
  paragraph: number
  text: string
  url: string
  originalSha256: string
  textKind: string
  language: string
}

export const knowledgeApi = {
  stats: () => http.get('/knowledge/stats') as Promise<Record<string, number>>,
  search: (kw = '', page = 1) => http.get('/knowledge/documents', { params: { kw, page, pageSize: 20 } }) as Promise<{ total: number; list: KnowledgeReference[] }>,
  document: (id: string, page = 1) => http.get(`/knowledge/documents/${encodeURIComponent(id)}`, { params: { page } }) as Promise<KnowledgeDocument>,
}

export interface QaRecord {
  _id: string
  userId: string
  username: string
  question: string
  answer: string
  dimension: string
  provider: string
  graphMatched: boolean
  entityNames: string[]
  createdAt: string
  conversationId?: string
  resolvedQuestion?: string
  documentId?: string
  snapshot?: QaResponse
}

export interface ConversationSummary {
  _id: string
  title: string
  documentId?: string
  createdAt: string
  updatedAt: string
}

export const conversationApi = {
  list: (page = 1, pageSize = 20) =>
    http.get('/conversations', { params: { page, pageSize } }) as Promise<{ list: ConversationSummary[]; total: number; page: number; pageSize: number }>,
  detail: (id: string) =>
    http.get(`/conversations/${encodeURIComponent(id)}`) as Promise<{ conversation: ConversationSummary; records: QaRecord[] }>,
  rename: (id: string, title: string) =>
    http.patch(`/conversations/${encodeURIComponent(id)}`, { title }) as Promise<ConversationSummary>,
}

export interface HistoryPage {
  list: QaRecord[]
  total: number
  page: number
  pageSize: number
}

export const historyApi = {
  list: (params?: { page?: number; pageSize?: number }) =>
    http.get('/history', { params }) as Promise<HistoryPage>,
  remove: (id: string) => http.delete(`/history/${id}`),
  clear: () => http.delete('/history'),
}

export const ttsApi = {
  /** 文本转语音，直接返回音频 Blob */
  async synthesize(text: string, voice?: string): Promise<Blob> {
    const token = localStorage.getItem('token') || ''
    const res = await fetch(`/api/tts/synthesize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text, voice }),
    })
    if (!res.ok) {
      let msg = `语音合成失败: ${res.status}`
      try {
        const j = await res.json()
        msg = typeof j.message === 'string' ? j.message : msg
      } catch {}
      throw new Error(msg)
    }
    return res.blob()
  },
}
