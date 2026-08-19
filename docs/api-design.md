# MediBrain-Hospital API 设计文档

> 更新日期：2026-08-18（v1.2.0）· 全局前缀 `/api` · 端口 3000

## 一、通用约定

- **协议**：HTTP/JSON（TTS 返回音频流）
- **认证**：JWT Bearer（`Authorization: Bearer <token>`），有效期 7 天
- **校验**：全局 `ValidationPipe`（whitelist + transform + forbidNonWhitelisted）
- **统一响应包裹**：`{ code, message, data }`（登录/问答等接口见各节）
- **健康检查**：`GET /api/health`

## 二、接口清单

### 2.1 认证 Auth — `/api/auth`

| 方法 | 路径 | 认证 | 请求体/参数 | 说明 |
|------|------|------|-------------|------|
| POST | `/auth/register` | 无 | `{ username(≥3), password(≥6), identity? }` | 注册（role 强制 user），返回 `{ token }` |
| POST | `/auth/login` | 无 | `{ username, password }` | 登录，返回 `{ token, user }`；`isActive=false` 返回 401 |
| GET | `/auth/profile` | JWT | — | 返回 `{ userId, username, role, identity }` |
| GET | `/auth/admin-only` | JWT+Admin | — | 管理员测试接口 |

**identity 枚举**：`医生 | 护士 | 药师 | 医学生 | 患者 | 患者家属 | 普通用户`

### 2.2 智能问答 Qa — `/api/qa`

| 方法 | 路径 | 认证 | 请求体/参数 | 说明 |
|------|------|------|-------------|------|
| POST | `/qa/ask` | JWT | `{ question(≥2) }` | 问答主接口，自动写历史 |
| GET | `/qa/search?kw=` | 无 | kw | 实体联想（模糊匹配，最多 8 条） |
| GET | `/qa/disease?name=` | 无 | name | 疾病详情图谱 |

**POST /qa/ask 响应**：

```json
{
  "answer": "根据医学知识图谱，关于「高血压」的信息如下：...",
  "entities": [{ "name": "高血压", "type": "疾病" }],
  "dimension": "宜吃食物",
  "sources": [{ "entity": "芹菜", "relation": "疾病宜吃食物", "label": "食物" }],
  "provider": "deepseek",
  "graphMatched": true,
  "vectorMatched": false,
  "vectorCandidates": [{ "name": "血压高", "type": "疾病症状", "score": 0.7766 }]
}
```

字段说明：
- `graphMatched`：图谱规则命中
- `vectorMatched`：向量兜底命中疾病候选
- `vectorCandidates`：语义候选列表（`score` 为 COSINE 相似度，阈值 ≥ 0.6）

**dimension 枚举**：症状 / 宜吃食物 / 忌吃食物 / 常用药品 / 所需检查 / 并发症 / 所属科目 / 治疗方法 / null（未识别）

### 2.3 问答历史 History — `/api/history`（类级 JWT）

| 方法 | 路径 | 参数 | 说明 |
|------|------|------|------|
| GET | `/history?all=&page=&pageSize=` | `all=true` 查全量；page 默认 1，pageSize 默认 20 | 我的历史（createdAt DESC） |
| DELETE | `/history` | — | 清空我的全部记录 |
| DELETE | `/history/:id` | id | 删单条（仅本人或 admin，他人伪装 404） |

### 2.4 图谱管理 Graph — `/api/graph`（类级 JWT + GraphGuard）

> GraphGuard：admin **或** identity=医生，否则 403

| 方法 | 路径 | 参数 | 说明 |
|------|------|------|------|
| GET | `/graph/meta` | — | `{ labels, relationTypes }`（8 标签 / 9 关系） |
| GET | `/graph/nodes` | `label?`(enum) `kw?` `page?` `pageSize?` | 分页节点（标签/关键词过滤） |
| POST | `/graph/nodes` | `{ label, properties }` | 创建节点（properties 须含「名称」，同标签唯一） |
| PUT | `/graph/nodes` | `{ label, name, properties }` | 更新节点（可改名，防冲突） |
| DELETE | `/graph/nodes` | `{ label, name }` | 删除节点（DETACH 连带关系） |
| GET | `/graph/relations` | `kw?` `page?` `pageSize?` | 分页关系 |
| POST | `/graph/relations` | `{ type, fromLabel, fromName, toLabel, toName }` | 创建关系（MERGE 幂等，端点必须存在） |
| DELETE | `/graph/relations` | 同上 | 删除关系 |

**label 枚举**：疾病 / 药品 / 药品商 / 疾病症状 / 食物 / 检查项目 / 治疗方法 / 科目
**relation 枚举**：疾病宜吃食物 / 疾病的症状 / 疾病使用药品 / 治疗的方法 / 疾病所需检查 / 疾病忌吃食物 / 生产 / 疾病并发疾病 / 疾病所属科目

### 2.5 语音合成 Tts — `/api/tts`（类级 JWT）

| 方法 | 路径 | 参数 | 说明 |
|------|------|------|------|
| POST | `/tts/synthesize` | `{ text(1-2000), voice? }` | 合成并直接返回 mp3（`audio/mpeg`）；MD5 内容缓存 |
| GET | `/tts/audio/:file` | file | 音频流（inline） |

**voice 默认**：`zh-CN-XiaoxiaoNeural`（edge-tts 晓晓）

### 2.6 健康检查 Health — `/api/health`（无认证）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | Terminus：Mongo ping + Redis ping，返回 `{ status, info, error }` |

### 2.7 其他 App — `/api`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | "Hello World!" |
| POST | `/chat-test` | `{ message }` → `{ provider, reply }`（LLM 连通测试，临时接口，无认证） |

## 三、错误约定

| 状态码 | 场景 |
|--------|------|
| 400 | ValidationPipe 校验失败（含未声明字段） |
| 401 | 未登录 / Token 失效 / 账号禁用 |
| 403 | 角色或身份权限不足（GraphGuard / RolesGuard） |
| 404 | 资源不存在（含伪装 404：无权删除他人历史） |
| 500 | 服务端异常（LLM 失败已降级不返回 500） |

错误体：`{ statusCode, message, error }`（NestJS 默认格式）

## 四、认证与权限模型

```
JWT payload: { sub: userId, username, role, identity }
守卫链:     AuthGuard('jwt') → RolesGuard(@Roles) / GraphGuard
```

| 控制点 | 机制 |
|--------|------|
| RolesGuard | 有 `@Roles` 元数据则校验 role，不匹配 403 |
| GraphGuard | admin 或 identity=医生，否则 403 |
| History 删除 | 仅本人或 admin（非本人伪装 404） |

## 五、安全注意事项（P3 待办）

- `JWT_SECRET` 默认 `please-change-me`，生产必须更换
- `POST /api/chat-test` 无认证，建议下线或加守卫
- `/qa/ask` 与 `/tts/synthesize` 无限流，防滥用
- `synchronize: true` 生产环境建议关闭