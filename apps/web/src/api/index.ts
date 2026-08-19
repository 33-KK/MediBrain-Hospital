import http from './http'

export interface LoginPayload {
  username: string
  password: string
}

export interface RegisterPayload {
  username: string
  password: string
  identity?: string
}

export interface UserInfo {
  userId?: string
  username: string
  role: string
  identity?: string
}

export const authApi = {
  login: (data: LoginPayload) => http.post('/auth/login', data),
  register: (data: RegisterPayload) => http.post('/auth/register', data),
  profile: () => http.get('/auth/profile'),
}

export interface QaResponse {
  answer: string
  entities: { name: string; type: string }[]
  dimension: string | null
  sources: { entity: string; relation: string; label: string }[]
  provider: string
  graphMatched: boolean
  vectorMatched?: boolean
  vectorCandidates?: { name: string; type: string; score: number }[]
}

export const qaApi = {
  ask: (question: string) =>
    http.post('/qa/ask', { question }) as Promise<QaResponse>,
  search: (kw: string) =>
    http.get('/qa/search', { params: { kw } }) as Promise<{ name: string; label: string; desc?: string }[]>,
  disease: (name: string) =>
    http.get('/qa/disease', { params: { name } }) as Promise<any>,
}

export interface QaRecord {
  _id: string
  userId: string
  username: string
  identity: string
  question: string
  answer: string
  dimension: string
  provider: string
  graphMatched: boolean
  entityNames: string[]
  createdAt: string
}

export interface HistoryPage {
  list: QaRecord[]
  total: number
  page: number
  pageSize: number
}

export const historyApi = {
  list: (params?: { all?: boolean; page?: number; pageSize?: number }) =>
    http.get('/history', { params }) as Promise<HistoryPage>,
  remove: (id: string) => http.delete(`/history/${id}`),
  clear: () => http.delete('/history'),
}

export interface GraphNode {
  name: string
  label: string
  properties: Record<string, string | number>
}

export interface GraphRelationRow {
  from: string
  fromLabel: string
  type: string
  to: string
  toLabel: string
}

export interface GraphPage<T> {
  list: T[]
  total: number
}

export interface GraphMeta {
  labels: string[]
  relationTypes: string[]
}

export const graphApi = {
  meta: () => http.get('/graph/meta') as Promise<GraphMeta>,
  nodes: (params?: { label?: string; kw?: string; page?: number; pageSize?: number }) =>
    http.get('/graph/nodes', { params }) as Promise<GraphPage<GraphNode>>,
  createNode: (data: { label: string; properties: Record<string, string | number> }) =>
    http.post('/graph/nodes', data),
  updateNode: (data: { label: string; name: string; properties: Record<string, string | number> }) =>
    http.put('/graph/nodes', data),
  deleteNode: (data: { label: string; name: string }) =>
    http.delete('/graph/nodes', { data }) as Promise<{ deleted: boolean }>,
  relations: (params?: { kw?: string; page?: number; pageSize?: number }) =>
    http.get('/graph/relations', { params }) as Promise<GraphPage<GraphRelationRow>>,
  createRelation: (data: {
    type: string
    fromLabel: string
    fromName: string
    toLabel: string
    toName: string
  }) => http.post('/graph/relations', data),
  deleteRelation: (data: {
    type: string
    fromLabel: string
    fromName: string
    toLabel: string
    toName: string
  }) => http.delete('/graph/relations', { data }) as Promise<{ deleted: boolean }>,
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
