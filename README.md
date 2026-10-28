# MediBrain-Hospital · 医疗知识图谱智能问答平台

面向医疗场景的企业级全栈 AI 平台：以 **Neo4j 医学知识图谱 + Milvus 向量库**为知识底座，
当前使用 **图谱词典实体识别 + 图谱 / 向量检索 + 多模型网关**，提供智能问答、医学资料检索和图谱可视化。所有账号统一登录，不再区分角色或医疗身份。答案由服务端按图谱记录生成，模型仅参与事实排序。

前端采用橙白医学问答界面，包含顶部品牌栏、侧边导航、推荐问题与底部输入区，支持手机布局。界面与验收记录见 [2026-10-14 界面更新](docs/orange-ui-2026-10-14.md)。

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Vue 3 + TypeScript + Element Plus + Pinia + Vite |
| 后端 | NestJS (Monorepo) + TypeORM + Redis |
| 存储 | MongoDB（业务）/ Neo4j（知识图谱）/ Milvus（向量）/ MinIO（文件） |
| 模型 | 图谱词典最长匹配 / 多模型适配层（DeepSeek 官方 · 阿里云百炼 · Ollama） |
| 向量化 | 当前本机 Ollama bge-m3；可配置云端向量模型 |
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

前后端使用 Node.js 24。当前本机集群已发布修复版本，运行以下脚本恢复访问端口，然后打开 http://localhost:8090：

```powershell
./scripts/maintenance/start-local-access.ps1
# 本机开发或维护工具需要数据库转发时加 -Dependencies
```

本机默认使用 Ollama `qwen2.5:7b` 和 `bge-m3`，确认 Ollama 已启动且模型已安装。云端模型仍可通过环境配置切换。

```bash
# 1. 环境变量
cp .env.example .env
# 生成 JWT_SECRET 并填入 .env；配置 Neo4j 密码与所选模型的 API Key。
# 如果使用 Neo4j Desktop，把 NEO4J_URI 改为 bolt://localhost:7687。

# 2. 启动基础设施（Mongo/Redis/Milvus/Neo4j/MinIO）
docker compose -f deploy/docker/docker-compose.yml up -d

# 3. 启动后端
cd apps/server && npm i && npm run start:dev

# 4. 启动前端
cd apps/web && npm i && npm run dev
```

如果基础设施已经运行在本机 Kubernetes 中，可以复用集群 MongoDB 和 Redis。分别在两个终端保持以下命令运行，然后启动本机后端：

```powershell
kubectl port-forward -n medibrain service/medibrain-mongo 27017:27017 --address 127.0.0.1
kubectl port-forward -n medibrain service/medibrain-redis 6379:6379 --address 127.0.0.1
```

本机 `MONGO_URI` 需要使用集群已有账号及密码，并指定 `authSource=admin`；Redis 如启用认证也需填写 `REDIS_PASSWORD`。Neo4j Desktop 使用 `bolt://localhost:7687`。这些 localhost 地址用于宿主机启动应用。

开发环境未配置 `JWT_SECRET` 时会生成临时随机密钥，重启后需要重新登录。需要保留登录状态时，运行 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` 并将生成值保存到本机 `.env` 的 `JWT_SECRET`。

## 检查与修复记录

最新事实约束、语音缓存、导入出处与性能 / 内容验收见 [2026-10-08 验收记录](docs/acceptance-2026-10-08.md)。此前的处理结果见 [完成记录](docs/completion-2026-10-07.md)，第一阶段记录保留在 [修复记录](docs/repairs-2026-10-07.md)。

```powershell
cd apps/server
npm run lint:check
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run build
npm run test:regression
# 需要 Docker 和可连接的 Neo4j；使用一次性 MongoDB/Redis 容器，Neo4j 只读。
npm run test:integration
```

## 医学知识库补充资料

已将 1,016 条 MedlinePlus 英文主题摘要、5 份国家卫健委中文食养资料、3 条 WHO 来源及中文释义草稿写入 Neo4j 医学资料库，共 1,024 份资料、284 页 PDF 原文。登录后从侧栏进入“医学资料库”检索阅读，或提问“脑卒中有哪些食养指南”查看资料卡片。资料保持待专业复核，不自动覆盖现有临床事实。来源、导入报告和复现命令见 [2026-10-11 医学资料说明](docs/medical-data-sources-2026-10-11.md)。

## 生产部署

本机开发使用 `.env.example` 中的 localhost 和宿主机映射端口。应用运行在容器网络内时，应改用服务名和容器端口；Kubernetes 清单已经为 MongoDB、Redis、Neo4j 设置集群内地址。后端优先读取 `apps/server/.env`，再读取根目录 `.env`。生产环境必须提供至少 32 字符的非默认 `JWT_SECRET`。

注册只填写用户名和密码。登录账号统一使用问答、医学资料检索、疾病详情和只读知识图谱；每个账号只能查看、删除或清空自己的问答历史。已移除角色授权、用户管理和图谱增删改页面及接口。

旧账号密码和问答记录可继续使用，旧 token 中的身份字段不参与处理。更新前后端后，可运行 `node scripts/maintenance/remove-user-classification.cjs` 检查历史字段；加 `--apply` 会先备份旧角色/身份元数据，再移除这些字段，不修改账号密码、启用状态或问答正文。

健康接口：`/api/health/live` 检查进程存活，`/api/health/ready` 检查 MongoDB、Redis 和 Neo4j，就绪失败返回 503；`/api/health` 同时报告 Milvus、embedding 和模型状态，可选依赖失败时显示 `degraded`。

图谱变更和待同步任务在 Neo4j 中同一事务提交。后台每 30 秒重试，进程退出或 Redis 不可用不会丢失已提交的同步任务。

镜像构建 / K8s 部署（kind 演示与真实集群）/ CI/CD（Jenkins）完整流程见 **[docs/deployment.md](docs/deployment.md)**。

- 镜像：`deploy/docker/server.Dockerfile`、`deploy/docker/web.Dockerfile`
- K8s 清单：`deploy/k8s/`（server + web + infra + configmap + secret）
- CI/CD：根目录 `Jenkinsfile`
- 图谱数据迁移（开发库 → 生产库）：`scripts/graph-migration/README.md`

## 已实现功能

- 用户注册/登录（JWT），统一账号，无角色与身份选择
- 智能问答：知识图谱检索 + 多模型 LLM（DeepSeek 等）+ 本地模型降级
- 问答历史记录（仅本人查看、删除与清空）
- 只读图谱可视化、疾病详情、医学资料检索阅读
- 生产化：Docker 镜像、K8s 部署（含 HPA 自动伸缩）、Jenkins CI/CD 流水线

## 许可

本项目用于商用与简历展示，详见 `LICENSE`（未添加）。
