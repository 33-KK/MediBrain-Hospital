# MediBrain-Hospital 项目计划与进度总览

> 医疗知识图谱智能问答平台 · 更新日期：2026-08-19（v1.2.0 全链路收尾完成）

## 一、项目目标

面向医疗场景的企业级全栈 AI 平台：以 **Neo4j 医学知识图谱 + Milvus 向量库**为知识底座，融合 **NER 实体识别 + RAG 混合检索 + 多模型大模型网关**，提供智能问答、知识库管理、图谱可视化与语音交互。

## 二、总体进度

| 阶段 | 内容 | 状态 |
|------|------|------|
| 1 | 项目骨架（Monorepo：web/server/shared）+ 认证授权（JWT，7 种身份） | ✅ 完成 |
| 2 | 智能问答（图谱检索 + LLM 多模型网关 + 降级） | ✅ 完成 |
| 3 | 知识库管理（图谱可视化、疾病详情、历史记录） | ✅ 完成 |
| 4 | 医生端图谱管理（GraphModule 前后端，节点/关系 CRUD） | ✅ 完成 |
| 5 | 语音交互（edge-tts TTS） | ✅ 完成 |
| 6 | 生产化部署（Docker/K8s/Jenkins/镜像 v1.1.0） | ✅ 完成 |
| 7 | 图谱数据迁移（4.9 万实体全量迁移开发库 → 集群） | ✅ 完成 |
| 8 | 向量化（Milvus + bge-m3 索引 + 问答兜底，v1.2.0） | ✅ 完成 |
| 9 | 数据扩充（多病种知识库） | ✅ 完成（5 病种扩充工具链 + 全链路导入） |
| 10 | 真实集群部署 + CI/CD 落地 | 🔄 进行中（CI/CD ✅ 已跑通；真实集群交付物就绪，待云服务器执行） |
| 11 | 文档与商用化收尾 | ✅ 完成（含安全合规 P3 全项） |

## 三、已实现功能（截至 v1.2.0）

### 核心业务
- 用户注册/登录（JWT），7 种身份（医生/护士/药师/医学生/患者/患者家属/普通用户），按身份定制回答风格
- 智能问答：图谱规则命中 → LLM 生成；未命中 → **向量检索兜底**（Milvus Top-K 候选回填图谱事实）
- 问答历史记录（个人/管理端全量查看、删除）
- 图谱可视化、疾病详情查询
- **医生端图谱管理**：节点/关系双 Tab CRUD，8 标签白名单 + 9 关系类型校验，admin/医生双权限
- **语音交互**：edge-tts 合成直接返回音频（多副本无共享存储问题）

### 向量化（阶段 8，已验收）
- Milvus v2.5.4 standalone（docker-compose 修正：ETCD_USE_EMBED + MINIO_ADDRESS）
- 离线索引：49278 实体全量写入（12 分钟，68 条/秒，断点续传 + 降级重试）
- 在线检索：EmbeddingModule（本地 bge-m3 / 阿里云 text-embedding-v4 自动切换）
- **Top-5 命中率 91.2%（57 条抽样，含命名变体 100%）**，超过 85% 验收线
- 降级保障：Milvus 熔断冷却 + unhandledRejection 全局兜底，宕机不影响问答

### 部署
- Docker Compose（开发/单机）+ 镜像构建（server/web）+ 本地 registry 推送
- K8s（kind 3 节点演示集群，HPA 自动伸缩，Ingress 8090）
- 集群全链路验证通过（问答/向量兜底/TTS/图谱管理）
- 镜像版本：server v1.2.0 / web v1.2.0（localhost:5000 registry）

### 数据扩充（阶段 9，已完成）
- 工具链：`scripts/graph-expansion/import.js`（JSON → Neo4j 幂等导入，8 类关系 + 别名 + 简介/预防/易感人群）、`dedupe.js`（同名节点合并清理）
- 数据文件：`scripts/graph-expansion/data/diseases/*.json`（脑卒中/类风湿关节炎/甲状腺功能亢进/慢性阻塞性肺疾病/抑郁症，含别名、症状、检查、药品+用法、宜忌食物、并发症、治疗、易感人群、简介、预防）
- 导入验证：源库 49439 实体（+161）、Milvus 全量重索引（修复 query 16384 limit 去重缺陷）、集群 Neo4j 同步（49440 节点）
- 集群问答实测：脑卒中症状/甲亢用药/中风忌食全部命中（规则命中含别名）

### 同义实体归一化（P2，已完成）
- 剂型/检查后缀表（35+8 个）：`entity-recognition.service.ts` 内 DRUG_FORM_SUFFIXES / CHECK_SUFFIXES
- NER 变体识别：词典加载时构建 短名→长名 变体映射（CT→CT检查、甲硝唑→甲硝唑乳膏、奥美拉唑→肠溶胶囊），识别阶段直接命中主实体
- 候选去重：`dedupeCandidates` 按归一化名合并向量候选，保留最高分（甲硝唑凝胶 重复候选 已合并）
- 邻居双向查询：`GraphService.getEntityNeighbors` 增加入边（UNION ALL），药品/检查实体可查到"哪些疾病使用/需要它"

## 四、待办事项（按优先级）

### P0 收尾（建议先做）
- [x] **数据扩充**：JSON 数据文件 + 批量导入脚本 + 源库/Milvus/集群全链路导入（5 病种已上线）
- [x] **web v1.2.0 对齐**：镜像 medibrain-web:v1.2.0 已构建推送并 rollout

### P1 工程化
- [x] **CI/CD 落地**：Jenkins（Docker 容器，lts-jdk17）已部署，8 项插件 + kubeconfig/server-env 凭据已配置，`medibrain-pipeline` Job 全流程跑通：lint/build → docker build → push(registry) → kind load → kubectl set image → rollout 验证（构建 #13 SUCCESS，镜像 `13-bd1f80ad` 已上线）
- [ ] **真实集群部署**：交付物已就绪（`deploy/k8s/production/`：README + hostAliases 生产 manifest + `deploy-prod.sh` 一键脚本），待云服务器后执行
- [x] **文档补全**：`docs/architecture.md`、`docs/database-schema.md`、`docs/api-design.md` 已完成

### P2 产品增强
- [x] 向量检索命中展示（Chat.vue 已展示「向量检索命中」标签 + 语义候选列表，可点击跳转疾病详情）
- [x] 语义检索候选实体去重（同义实体归一化：剂型/检查后缀双向映射，NER 变体识别 + 候选去重 + 图谱邻居双向查询）

### P3 安全与合规
- [x] 生产密钥更换（JWT_SECRET 随机化、Neo4j 集群改密、Mongo 启用认证 + 新凭据、MinIO 新密钥、LLM Key 占位符清理）——本地 .env 与集群 Secret 同步更新
- [x] 敏感接口限流（Redis 计数：问答 30 次/60s/用户、TTS 10 次/60s/用户，429 带 TTL 提示，Redis 故障放行）——集群实测触发 429 通过
- [x] 医疗数据合规声明（`docs/compliance.md`：免责/数据来源/隐私/安全基线清单）

## 五、验收标准对照

| 标准 | 结果 |
|------|------|
| 图谱实体 ≥ 500，覆盖 20+ 常见病种 | ✅ 49439 实体（8808 疾病） |
| 向量检索 Top-5 命中率 ≥ 85% | ✅ 91.2%（`scripts/embedding/evaluate-top5.js` 可重跑） |
| 向量检索失败不影响问答 | ✅ 已实测降级 |
| 索引脚本幂等可重跑 | ✅ 断点续传 + 去重 |

## 六、关键脚本/文档索引

| 资源 | 位置 |
|------|------|
| 向量离线索引 | `scripts/embedding/index-graph.js` |
| 命中率验收 | `scripts/embedding/evaluate-top5.js` |
| 图谱迁移 | `scripts/graph-migration/README.md` |
| 图谱扩充导入 | `scripts/graph-expansion/import.js`（数据在 `data/diseases/*.json`） |
| 部署手册（含 v1.2.0 升级命令） | `docs/deployment.md` |
| 向量化方案与完成记录 | `docs/graph-expansion.md` |
