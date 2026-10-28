# 图谱数据扩充与 Embedding 向量化方案

> 本文保留早期设计背景，下面的“现状”不是当前运行状态。2026-10-11 新增的官方医学来源、实际下载结果和待复核数据包见 [医学资料采集说明](medical-data-sources-2026-10-11.md)。外部候选资料须复核后再通过正式写入与索引同步流程接入。

> 目标：从"单病种演示数据"升级为"医院级多病种知识库"，并为语义检索准备向量索引。

## 一、现状

- Neo4j 图谱已有 8 类关系（宜吃食物/忌吃食物/症状/检查/药物/并发症/所属科室/易发人群）
- 数据量有限（高血压等少量演示疾病），通过 Cypher 脚本手动导入
- Milvus 向量库已编排（docker-compose 中有 `milvus` 服务），但未接入数据

## 二、数据扩充路线

### 2.1 数据来源（按优先级）

| 来源 | 形式 | 收益 |
|------|------|------|
| 公开医学知识库（丁香园/医脉通/默沙东手册） | 结构化页面爬取 | 覆盖面广，需清洗 |
| 国家卫健委诊疗指南 | PDF → 规则抽取 | 权威、更新及时 |
| 院内 HIS/病历数据（脱敏后） | 结构化数据库 | 院内真实场景，需权限审批 |
| 人工专家标注 | 问卷/工单 | 质量最高，成本高 |

### 2.2 推荐落地方式：JSON 数据文件 + 批量导入脚本

不直接写死 Cypher，改为「数据文件 + 导入工具」模式，便于团队协作维护：

```
apps/server/scripts/graph-data/
├── diseases/
│   └── 高血压.json        # 每个疾病一个文件
├── drugs.json             # 药物库
├── foods.json             # 食物库
└── import.ts              # 批量导入入口（TS 脚本，复用服务层逻辑）
```

示例数据结构（`高血压.json`）：

```json
{
  "name": "高血压",
  "aliases": ["原发性高血压"],
  "department": "心血管内科",
  "symptoms": ["头晕", "头痛", "心悸"],
  "tests": ["血压测量", "24小时动态血压监测"],
  "drugs": [
    { "name": "氨氯地平", "usage": "每日一次,一次5mg" },
    { "name": "氢氯噻嗪", "usage": "每日一次,一次12.5mg" }
  ],
  "foods_ok": ["芹菜", "燕麦"],
  "foods_bad": ["咸菜", "肥肉"],
  "complications": ["冠心病", "脑卒中"],
  "population": ["中老年人", "肥胖人群"]
}
```

导入脚本流程（`import.ts`）：
1. 读取 JSON 文件，按文件类型归因实体
2. 用 `MERGE (n:Entity {name}) SET n:Label` 幂等写入节点
3. `MERGE` 关系并带 `weight/source` 属性
4. 全部完成后批量 `CREATE INDEX`（若不存在）

## 三、Embedding 向量化

### 3.1 目标

- 用向量检索解决长尾问题（用户提问措辞与图谱实体不完全匹配）
- 流程：用户问题 → embedding → Milvus 检索 Top-K 相似实体 → 作为图谱查询候选

### 3.2 架构接入点

```
用户问题
   │
   ├─ 规则/命名实体识别（已有 GraphService.searchEntity）
   │
   └─ embedding 向量检索（新增，兜底）
        │  query_text ─→ embedding model ─→ Milvus 检索
        │      候选实体（名称+类型）
        └─→ 回填问答 prompt 的图谱事实
```

### 3.3 配置（已在 configuration.ts 预留）

```env
EMBEDDING_MODEL=text-embedding-v4   # 或 bge-m3（本地 Ollama）
EMBEDDING_API_KEY=xxx
MILVUS_URI=localhost:19530
```

### 3.4 实施步骤

1. **建集合**：`entities` 集合，字段 = `{ entity_name, entity_type, entity_desc, embedding[1024] }`（COSINE，AUTOINDEX）
2. **离线索引**：把图谱全部实体名 + 简介做 embedding 写入 Milvus（脚本 `scripts/embedding/index-graph.js`）
3. **在线检索**：`QaService.ask` 中，图谱规则未命中时调用向量检索候选实体，再用候选实体名查询图谱事实
4. **降级**：Milvus 不可用时静默跳过，维持当前规则命中流程

### 3.5 已完成（2026-08-18）

- Milvus v2.5.4 standalone 已启动（docker-compose 修正：需 `ETCD_USE_EMBED=true` + `MINIO_ADDRESS=minio`，否则镜像默认连外部 etcd localhost:2379 起不来）
- 离线索引脚本 `scripts/embedding/index-graph.js` 可用（幂等去重 + 断点续传 + 超长文本降级重试），**49278 实体全部写入，耗时约 12 分钟（68 条/秒）**，实测语义检索命中正确（"血压高"→高血压、"感冒吃什么药"→感冒灵颗粒）
- 注意：脚本中 insert 字段名必须与 schema 一致（entity_name/entity_type/entity_desc），字段名错误会被 SDK 静默接受导致数据丢失；重建集合用 `c.dropCollection` + `remove index-progress.json`
- **B 步骤 3-4 已完成**：`EmbeddingModule`（`apps/server/src/embedding/`）已接入 `QaService` 兜底：
  - 规则未命中时，问题 → embedding（本地 bge-m3 / 阿里云 text-embedding-v4 自动切换）→ Milvus Top-K 候选 → 疾病候选查 `getDiseaseInfo`、非疾病候选查 `getEntityNeighbors` 回填图谱事实
  - 响应新增 `vectorMatched` / `vectorCandidates` 字段（前端可展示兜底命中）
  - **降级**：Milvus 不可用时 60s 熔断冷却直接跳过；`main.ts` 增加 `unhandledRejection` 兜底（Milvus SDK 的 gRPC 内部 rejection 会打崩进程，必须拦截）；embedding/检索任何失败静默返回空，不影响规则命中链路（已实测：Milvus 指向无效地址时问答正常）
  - 配置见 `.env`：`EMBEDDING_MODEL`/`EMBEDDING_BASE_URL`/`MILVUS_URI`/`MILVUS_COLLECTION`/`EMBEDDING_TOP_K`/`EMBEDDING_THRESHOLD`
  - 实测：血压高→高血压宜吃食物 ✅、发烧吃什么药→小儿发烧药品 ✅、无关问题不误命中 ✅、Milvus 宕机不影响问答 ✅

## 四、验收标准

- [x] 图谱实体数 49278（已超出 500 目标，覆盖 8 标签全量）
- [x] 索引脚本幂等可重复运行（断点续传）
- [x] 向量检索 Top-5 命中率 ≥ 85%（**抽样 57 条真实问题：严格匹配 91.2%，含命名变体 100%**，见 `scripts/embedding/evaluate-top5.js`）
- [x] 向量检索失败不影响现有问答链路（已实测降级）
