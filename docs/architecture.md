# MediBrain-Hospital 系统架构文档

> 更新日期：2026-08-18（v1.2.0）

## 一、系统定位

面向医疗场景的企业级全栈 AI 平台：以 **Neo4j 医学知识图谱 + Milvus 向量库**为知识底座，融合 **NER 实体识别 + RAG 混合检索 + 多模型大模型网关**，提供智能问答、知识库管理、图谱可视化与语音交互。

## 二、总体架构

```
┌─────────────────────────────────────────────────────────────┐
│                         客户端层                             │
│    Vue3 Web（apps/web）  浏览器/移动端                        │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTP /api（Ingress 8090，JWT Bearer）
┌───────────────────────────▼─────────────────────────────────┐
│                      服务端层（NestJS）                      │
│  apps/server  · 全局前缀 /api  · 端口 3000                  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  业务模块                                              │  │
│  │  Auth(注册/登录/JWT)  Qa(问答)  History(历史)          │  │
│  │  Graph(图谱管理)  Tts(语音)  Health(健康检查)          │  │
│  ├───────────────────────────────────────────────────────┤  │
│  │  @Global 基础设施模块                                  │  │
│  │  Database(TypeORM MongoDB)  Redis(ioredis)            │  │
│  │  Llm(多模型网关)  Neo4j(driver+GraphService)          │  │
│  │  Entity(NER识别)  Embedding(Milvus检索+熔断)          │  │
│  └───────────────────────────────────────────────────────┘  │
└───────┬───────────┬───────────┬───────────┬────────────┬────┘
        │           │           │           │            │
   ┌────▼───┐  ┌────▼────┐  ┌───▼─────┐ ┌──▼─────┐  ┌───▼────┐
   │ Neo4j  │  │ MongoDB │  │ Redis   │ │ Milvus │  │ Ollama │
   │ 7687   │  │ 27017   │  │ 6379    │ │ 19540  │  │ 11434  │
   │ 图谱库 │  │ 业务库  │  │ 健康检查 │ │ 向量库 │  │ bge-m3 │
   └────────┘  └─────────┘  └─────────┘ └────────┘  │  qwen2.5│
        │                                            └────────┘
        │ 外部 LLM（可选）：DeepSeek / 阿里云百炼（OpenAI 兼容）
        └────────────────────────────────────────────────────
```

## 三、技术栈

| 层 | 技术 | 版本 |
|----|------|------|
| 前端 | Vue 3 + Vite + TypeScript + Element Plus | — |
| 后端 | NestJS 11 + TypeORM（MongoDB 驱动） | ^11 |
| 图谱 | Neo4j（8 标签 / 9 关系，4.9 万实体） | 5.x |
| 向量 | Milvus standalone + bge-m3（1024 维） | 2.5.4 |
| 业务库 | MongoDB（TypeORM 实体） | 7.5 |
| 缓存 | Redis（当前仅健康检查） | — |
| 模型 | DeepSeek / 阿里云百炼 / Ollama（qwen2.5:7b） | — |
| 语音 | edge-tts（Python 子进程） | — |
| 部署 | Docker Compose + kind(K8s) + Ingress + HPA | — |

## 四、模块职责

### 4.1 全局模块（@Global，无需 import 即可注入）

| 模块 | 职责 |
|------|------|
| `DatabaseModule` | TypeORM MongoDB 连接（`synchronize: true` 自动同步结构） |
| `RedisModule` | ioredis 单例（`REDIS_CLIENT`），指数退避重试 |
| `LlmModule` | `LlmGateway` 多模型适配（Ollama / OpenAI 兼容双 Provider） |
| `Neo4jModule` | `NEO4J_DRIVER` 连接池（20）+ `GraphService` 图谱查询 |
| `EntityModule` | `EntityRecognitionService` 实体词典 NER 识别 |
| `EmbeddingModule` | `EmbeddingService` 双引擎 embedding + Milvus 检索 + 60s 熔断 |

### 4.2 业务模块

| 模块 | 职责 |
|------|------|
| `AuthModule` | 注册/登录/Profile，JWT 签发与校验，7 身份体系 |
| `QaModule` | 问答主链路（NER → 维度 → 图谱 → 向量兜底 → LLM） |
| `HistoryModule` | 问答历史（个人分页 / 管理员全量 / 删除） |
| `GraphModule` | 图谱管理 CRUD（8 标签白名单 + 9 关系类型校验） |
| `TtsModule` | edge-tts 语音合成（MD5 内容缓存） |
| `HealthModule` | Terminus 健康检查（Mongo + Redis ping） |

## 五、问答主链路（QaService.ask）

```
用户问题
  → EntityRecognitionService：实体词典最长匹配 + 区间合并（最多 3 实体）
  → 意图维度分析：DIMENSION_KEYWORDS 8 类正则（症状/宜吃/忌吃/药品/检查/并发症/科目/治疗）
  → 图谱事实查询：按维度过滤关系（GraphService.getDiseaseInfo）
  → 命中？── 是 ──▶ 图谱事实 + 实体信息
  →           否 ──▶ EmbeddingService 向量兜底（Milvus Top-5，score ≥ 0.6）
  │                     └─ 疾病候选 → getDiseaseInfo；非疾病 → getEntityNeighbors
  → 按身份注入回答风格（IDENTITY_STYLES 7 套）
  → LlmGateway 生成（失败降级为图谱直答 buildFallbackAnswer）
  → 响应：answer / entities / dimension / sources / provider / graphMatched / vectorMatched? / vectorCandidates?
```

### 关键设计决策

1. **双引擎 embedding**：`EMBEDDING_MODEL` 以 `text-embedding` 前缀区分阿里云 DashScope，否则走 Ollama（bge-m3）。
2. **Milvus 熔断**：gRPC 失败后冷却 60s（`COOL_DOWN_MS`），期间直接返回空，不阻塞问答。
3. **进程兜底**：`main.ts` 监听 `unhandledRejection`，防 Milvus SDK 内部 rejection 崩进程。
4. **LLM 降级**：LLM 抛错 → 直接返回图谱事实（`buildFallbackAnswer`），不中断服务。
5. **实体词典**：启动时全量加载 4.9 万实体，过滤含"和、，,"的复合名，最长匹配 + 区间合并。

## 六、认证与权限

- **JWT**：`{ sub, username, role, identity }`，有效期 7 天，`Authorization: Bearer`。
- **角色（3 种）**：`admin` / `doctor` / `user`（注册强制为 user）。
- **身份（7 种）**：医生 / 护士 / 药师 / 医学生 / 患者 / 患者家属 / 普通用户（影响回答风格）。
- **权限控制**：
  - `RolesGuard`：`@Roles()` 元数据校验（admin 示例）；
  - `GraphGuard`：admin **或** identity=医生 可管理图谱，否则 403；
  - History 删除：仅本人或 admin（非本人伪装 404）。

## 七、部署架构

- **开发/单机**：Docker Compose（server/web/Neo4j/Mongo/Redis/Milvus/Ollama）
- **演示集群**：kind 3 节点 + HPA + Ingress（:8090）
  - server 3 副本（镜像 `localhost:5000/medibrain-server:v1.2.0`）
  - web 2 副本（镜像 `medibrain-web:v1.2.0`）
  - 向量链路经 Pod 内 `host.docker.internal` 访问宿主机 Ollama/Milvus
- **镜像**：`deploy/docker/server.Dockerfile`、`web.Dockerfile`

## 八、运维与扩展点

| 项 | 现状 | 规划 |
|----|------|------|
| CI/CD | Jenkinsfile 已就绪 | 配置凭据实际跑通 |
| Redis | 仅健康检查 | 缓存 / 会话 / 限流 |
| MinIO | 配置节已定义未使用 | 文件存储扩展 |
| 生产密钥 | JWT/Neo4j/MinIO 默认值 | P3 更换 |
| 限流 | 无 | P3 TTS/问答防滥用 |

## 九、已知技术债

- `synchronize: true` 生产环境自动同步风险（database.module.ts:14）
- History `all=true` 参数未校验 admin 角色
- minio 配置节已定义但无使用方
- TTS 音频存本地目录（多副本需共享存储）