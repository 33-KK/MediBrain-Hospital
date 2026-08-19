# MediBrain-Hospital 数据库设计文档

> 更新日期：2026-08-18（v1.2.0）· 数据量：Neo4j 49439 实体 / 303046 关系

## 一、存储总览

| 存储 | 用途 | 规模 |
|------|------|------|
| Neo4j（bolt://localhost:7687） | 医学知识图谱（实体 + 关系） | 49439 节点 / 303046 关系 |
| MongoDB（medibrain 库） | 业务数据（用户 / 问答记录） | 2 集合 |
| Milvus（entities 集合） | 实体向量检索（bge-m3 1024 维） | 49439 行 |
| Redis | 健康检查（暂未用于缓存/会话） | — |

---

## 二、Neo4j 知识图谱

### 2.1 节点标签（8 种，图谱管理白名单）

| 标签 | 说明 | 数量级 |
|------|------|--------|
| 疾病 | 疾病实体（含别名节点，通过「疾病别名」关联） | 8808+ |
| 药品 | 药品实体 | 数千 |
| 药品商 | 药品生产企业 | — |
| 疾病症状 | 症状实体 | — |
| 食物 | 宜吃/忌吃食物实体 | — |
| 检查项目 | 检查检验项目 | — |
| 治疗方法 | 治疗手段 | — |
| 科目 | 科室/医学学科 | — |

### 2.2 关系类型（9 种，图谱管理白名单）

| 关系类型 | 方向 | 语义 |
|----------|------|------|
| 疾病的症状 | 疾病 → 症状 | 疾病有哪些症状 |
| 疾病宜吃食物 | 疾病 → 食物 | 宜吃 |
| 疾病忌吃食物 | 疾病 → 食物 | 忌吃 |
| 疾病使用药品 | 疾病 → 药品 | 常用药 |
| 疾病所需检查 | 疾病 → 检查项目 | 检查手段 |
| 疾病并发疾病 | 疾病 → 疾病 | 并发症 |
| 疾病所属科目 | 疾病 → 科目 | 科室归属 |
| 治疗的方法 | 疾病 → 治疗方法 | 治疗方式 |
| 生产 | 药品商 → 药品 | 厂商生产 |
| 疾病别名 | 疾病 → 疾病 | 别名映射（扩充脚本引入） |

### 2.3 节点属性

**通用**：`名称`（必填，同标签下唯一）、`简介`

**疾病节点扩展属性**：`疾病简介`、`疾病病因`、`预防措施`、`治愈概率`、`治疗周期`、`疾病易感人群`

**药品节点**：`名称`、`用法`（扩充脚本支持，如"每日一次，一次5mg"）

### 2.4 疾病 → 关系维度映射（DISEASE_RELATION_QUERIES）

| 中文维度 | 图谱关系 | 查询上限 |
|----------|----------|----------|
| 症状 | 疾病的症状 | 15 |
| 宜吃食物 | 疾病宜吃食物 | 15 |
| 忌吃食物 | 疾病忌吃食物 | 15 |
| 常用药品 | 疾病使用药品 | 15 |
| 所需检查 | 疾病所需检查 | 15 |
| 并发症 | 疾病并发疾病 | 15 |
| 所属科目 | 疾病所属科目 | 15 |
| 治疗方法 | 治疗的方法 | 15 |

### 2.5 关键查询模式

```cypher
-- 实体词典加载（启动时，~4.9 万条）
MATCH (n) RETURN n.名称 AS name, labels(n)[0] AS label

-- 实体模糊搜索（联想）
MATCH (n) WHERE n.名称 CONTAINS $kw RETURN n.名称, labels(n)[0] LIMIT 8

-- 疾病详情（属性 + 8 类关系各 15 条）
MATCH (d:疾病 {名称: $name}) RETURN d

-- 实体邻居（非疾病候选兜底）
MATCH (n {名称: $name})-[r]->(t) RETURN type(r), t  LIMIT 30
```

### 2.6 索引

每个标签创建 `idx_<标签>` 索引（`ON (n:标签) ON (n.名称)`），导入脚本自动创建。

---

## 三、MongoDB（TypeORM 实体）

> 连接：`type: 'mongodb'`，`synchronize: true`，`autoLoadEntities: true`

### 3.1 集合 users（User 实体，auth/entities/user.entity.ts）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| _id | ObjectId | 主键 | |
| username | string | **unique 索引** | 登录名 |
| password | string | `select: false` | bcrypt 哈希，默认查询不返回 |
| displayName | string | default '' | 显示名 |
| role | enum | default 'user' | `admin` \| `doctor` \| `user` |
| identity | enum | default '普通用户' | 7 种身份（见下） |
| isActive | boolean | default true | 禁用标志，登录时校验 |
| createdAt | Date | default now | |

**UserIdentity 枚举（7 种）**：医生 / 护士 / 药师 / 医学生 / 患者 / 患者家属 / 普通用户

### 3.2 集合 qa_records（QaRecord 实体，history/entities/qa-record.entity.ts）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| _id | ObjectId | 主键 | |
| userId | string | | 提问人 |
| username | string | | |
| identity | string | default '' | 提问时身份快照 |
| question | string | | 问题原文 |
| answer | string | | 回答全文 |
| dimension | string | default '' | 意图维度 |
| provider | string | default '' | 实际 LLM provider |
| graphMatched | boolean | default false | 是否图谱命中 |
| entityNames | string[] | simple-array | 命中实体名 |
| createdAt | Date | default now | 分页按 createdAt DESC |

---

## 四、Milvus 向量库（entities 集合）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | Int64 | 主键（autoID） |
| entity_name | VarChar(512) | 实体名 |
| entity_type | VarChar(64) | 实体标签 |
| entity_desc | VarChar(2048) | 简介（`coalesce(简介, 疾病简介, 疾病病因)`） |
| embedding | FloatVector(1024) | bge-m3 向量 |

- **索引**：AUTOINDEX + COSINE 度量
- **检索**：问题向量 topK=5，过滤 `score >= 0.6`
- **生成**：`scripts/embedding/index-graph.js`（幂等，断点续传，去重分页拉全量）
- **数据来源**：Neo4j 全量实体（名称 + 简介拼接文本）

---

## 五、数据生命周期

```
图谱数据源（graph-dump.cypher / graph-expansion JSON）
   │  scripts/graph-migration/import4.js（迁移）
   │  scripts/graph-expansion/import.js（扩充，幂等 MERGE）
   ▼
Neo4j（源库 7687）
   │  图谱 CRUD（GraphModule 在线写入）
   ▼
Milvus（离线重跑 index-graph.js 增量同步）
   │
   ▼
问答链路（在线读取）
```

- **迁移**：`scripts/graph-migration/`（import4.js 清库重灌 + 幂等化处理）
- **扩充**：`scripts/graph-expansion/`（import.js 幂等导入 + dedupe.js 合并去重）
- **向量同步**：`scripts/embedding/index-graph.js`（增量去重，自动跳过已存在实体）

## 六、一致性说明

- 业务库（Mongo）与图谱（Neo4j）无事务关联，问答历史与图谱查询是独立操作
- 图谱管理 CRUD 直接写 Neo4j，Milvus 向量库需手动重跑索引脚本同步
- 别名节点（疾病别名）是独立的「疾病」节点，名称可能重复（不同标签可同名）