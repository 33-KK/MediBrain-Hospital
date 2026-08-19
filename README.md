# MediBrain-Hospital · 医疗知识图谱智能问答平台

面向医疗场景的企业级全栈 AI 平台：以 **Neo4j 医学知识图谱 + Milvus 向量库**为知识底座，
融合 **BERT 实体识别 + RAG 混合检索 + 多模型大模型网关**，提供智能问答、知识库管理、图谱可视化与运维看板。

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Vue 3 + TypeScript + Element Plus + Pinia + Vite |
| 后端 | NestJS (Monorepo) + TypeORM + Redis |
| 存储 | MongoDB（业务）/ Neo4j（知识图谱）/ Milvus（向量）/ MinIO（文件） |
| 模型 | BERT-NER（本地，F1≈94%）/ 多模型适配层（DeepSeek 官方 · 阿里云百炼 · Ollama） |
| 向量化 | 阿里云 text-embedding-v4（可切换本地 bge） |
| 部署 | Docker Compose（开发/单机）→ Docker Swarm（横向扩展）→ K8s（企业方案） |

## 项目结构

```
MediBrain-Hospital/
├── apps/
│   ├── web/              # Vue3 前端
│   └── server/           # NestJS 后端
├── packages/
│   └── shared/           # 前后端共享类型与工具
├── deploy/
│   ├── docker/           # Docker / Docker Compose 编排
│   ├── k8s/              # K8s 部署方案（Helm + 编排 YAML）
│   └── ci/               # CI/CD 流水线
├── docs/                 # 架构 & 部署文档
└── README.md
```

## 快速启动

```bash
# 1. 环境变量
cp .env.example .env

# 2. 启动基础设施（Mongo/Redis/Milvus/Neo4j/MinIO）
docker compose -f deploy/docker/docker-compose.yml up -d

# 3. 启动后端
cd apps/server && npm i && npm run start:dev

# 4. 启动前端
cd apps/web && npm i && npm run dev
```

## 生产部署

镜像构建 / K8s 部署（kind 演示与真实集群）/ CI/CD（Jenkins）完整流程见 **[docs/deployment.md](docs/deployment.md)**。

- 镜像：`deploy/docker/server.Dockerfile`、`deploy/docker/web.Dockerfile`
- K8s 清单：`deploy/k8s/`（server + web + infra + configmap + secret）
- CI/CD：根目录 `Jenkinsfile`
- 图谱数据迁移（开发库 → 生产库）：`scripts/graph-migration/README.md`

## 已实现功能

- 用户注册/登录（JWT），支持 7 种身份（医生/护士/药师/医学生/患者/患者家属/普通用户）
- 智能问答：知识图谱检索 + 多模型 LLM（DeepSeek 等）+ 本地模型降级
- 问答历史记录（个人/管理端全量查看、删除）
- 图谱可视化、疾病详情、按身份个性化的回答风格
- 生产化：Docker 镜像、K8s 部署（含 HPA 自动伸缩）、Jenkins CI/CD 流水线

## 许可

本项目用于商用与简历展示，详见 `LICENSE`（未添加）。