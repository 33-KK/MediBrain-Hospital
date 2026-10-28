# MediBrain-Hospital 部署手册

> 覆盖：开发环境（Compose）→ 镜像构建与推送 → K8s 部署（kind 演示 / 真实集群）→ CI/CD 接入。

前后端构建与后端运行镜像使用 Node.js 24。本机 `medibrain-prod` 集群当前使用统一登录版本，发布记录见 [统一登录变更](single-login-2026-10-14.md)，访问端口可通过 `scripts/maintenance/start-local-access.ps1` 恢复。

## 一、架构总览

```
浏览器
  │  http://<host> (Ingress / nginx)
  ▼
前端 medibrain-web (nginx 静态资源 + /api 反代)
  │  /api/*
  ▼
后端 medibrain-server (NestJS, 可水平扩展)
  │
  ├── MongoDB (用户/问答历史)   ── StatefulSet + PVC
  ├── Redis   (缓存)            ── Deployment
  ├── Neo4j   (知识图谱)        ── StatefulSet + PVC
  └── Ollama (本机 qwen2.5:7b + bge-m3，可配置云端模型)
```

## 二、开发环境（Docker Compose）

```bash
# 1. 启动基础设施（Mongo/Redis/Neo4j/Milvus/MinIO）
docker compose -f deploy/docker/docker-compose.yml up -d

# 2. 导入图谱数据（仅首次）→ 见 deploy/docker/README 或 scripts/graph-migration
# 3. 配置环境变量（参考根目录 .env.example）

# 4. 启动后端（开发模式）
cd apps/server && npm install && npm run start:dev

# 5. 启动前端（开发模式）
cd apps/web && npm install && npm run dev
# 访问 http://localhost:5173
```

## 三、镜像构建与推送

```bash
# 构建
docker build -f deploy/docker/server.Dockerfile -t <registry>/medibrain-server:v1.0.0 .
docker build -f deploy/docker/web.Dockerfile    -t <registry>/medibrain-web:v1.0.0 .

# 推送（本地 registry 验证：docker run -d -p 5000:5000 registry:2）
docker push <registry>/medibrain-server:v1.0.0
docker push <registry>/medibrain-web:v1.0.0
```

已在本机验证：`localhost:5000` registry 推送/拉取成功。

本次会话与资料问答发布镜像为后端 `medibrain-server:conversations-20261014`、前端 `medibrain-web:conversations-20261014`，验收见 [会话与资料问答](conversations-2026-10-14.md)。重新发布到现有 kind 集群：

```bash
docker build -f deploy/docker/server.Dockerfile -t medibrain-server:conversations-20261014 .
docker build -f deploy/docker/web.Dockerfile -t medibrain-web:conversations-20261014 .
kind load docker-image medibrain-server:conversations-20261014 medibrain-web:conversations-20261014 --name medibrain-prod
kubectl --kubeconfig kubeconfig-prod.utf8 --context kind-medibrain-prod -n medibrain set image deployment/medibrain-server server=medibrain-server:conversations-20261014
kubectl --kubeconfig kubeconfig-prod.utf8 --context kind-medibrain-prod -n medibrain set image deployment/medibrain-web web=medibrain-web:conversations-20261014
kubectl --kubeconfig kubeconfig-prod.utf8 --context kind-medibrain-prod -n medibrain rollout status deployment/medibrain-server
kubectl --kubeconfig kubeconfig-prod.utf8 --context kind-medibrain-prod -n medibrain rollout status deployment/medibrain-web
```

## 四、K8s 部署

### 4.1 kind 本地演示（已验证）

```bash
# 创建 3 节点集群（80 端口映射到宿主机 8090）
kind create cluster --config deploy/k8s/kind-config.yaml   # 或在任意位置创建含 extraPortMappings 的配置

# 加载镜像到集群节点
kind load docker-image <registry>/medibrain-server:v1.0.0 --name <cluster>
kind load docker-image <registry>/medibrain-web:v1.0.0 --name <cluster>

# 应用清单
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/infra/       # Mongo/Redis/Neo4j
kubectl apply -f deploy/k8s/configmap.yaml
kubectl apply -f deploy/k8s/secret.local.yaml  # 首次部署前从模板生成；此文件必须保持 Git 忽略
kubectl apply -f deploy/k8s/server/      # Deployment + Service + HPA
kubectl apply -f deploy/k8s/web/         # Deployment + Service + Ingress

# 安装 ingress-nginx（kind 专用清单）
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.12.1/deploy/static/provider/kind/deploy.yaml
kubectl label nodes <node> ingress-ready=true   # 全部节点打标签

# 验证
kubectl -n medibrain get pods         # 8 个 Pod 全部 1/1 Running
curl http://localhost:8090/api/health # {"status":"ok",...}
# 浏览器访问 http://localhost:8090
```

### 4.2 真实集群

```bash
# 镜像已推送至 registry，Deployment 中 image 改为 registry 地址
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/infra/
kubectl apply -f deploy/k8s/configmap.yaml
kubectl apply -f deploy/k8s/secret.local.yaml   # 或用 Vault/External Secrets 注入；已有集群保留当前真实密钥
kubectl apply -f deploy/k8s/server/
kubectl apply -f deploy/k8s/web/          # 按需修改 Ingress host

# 升级（CI 使用）
kubectl -n medibrain set image deployment/medibrain-server server=<registry>/medibrain-server:<tag>
kubectl -n medibrain rollout status deployment/medibrain-server
```

### 4.3 关键配置说明

| 组件 | 资源 | 说明 |
|------|------|------|
| server | Deployment (3) + HPA (2~10) | CPU 70% 自动伸缩，就绪/存活探针 `/api/health`；镜像含 Python + edge-tts（语音合成） |
| web | Deployment (2) + Ingress | nginx 静态服务，`/api` 反代 server |
| mongo | StatefulSet + PVC 10Gi | 数据持久化 |
| neo4j | StatefulSet + PVC 10Gi | 内存需调优（heap 2G/pagecache 512m） |
| redis | Deployment | 无状态，可换云托管 |

## 五、CI/CD（Jenkins）

根目录 `Jenkinsfile`：`lint/build → docker build → push → kubectl set image 滚动更新`。

所需凭据：`docker-registry`（镜像仓库）、`kubeconfig`（K8s 集群）、`server-env`（后端 .env）。

## 六、常见问题

| 问题 | 解决 |
|------|------|
| 页面 503 | Pod 重启中（Docker Desktop 重启导致），等 rollout 完成 |
| 图谱问答"未找到信息" | Neo4j 无数据 → 执行图谱迁移（scripts/graph-migration） |
| Neo4j OOM | 增大 NEO4J_server_memory_heap_max__size，同步调大容器 limits |
| Ingress 404 | 检查 Ingress host 是否与访问域名匹配（无 host 规则可匹配任意 Host） |
| 语音合成失败 | 确认 server 镜像含 Python 与 edge-tts（v1.1.0+）；多副本场景请用 v1.1.0 的直接返回音频接口（避免共享存储问题） |
| 向量兜底不生效（QA 返回未找到） | ① 本机开发：确认 Ollama 已 `ollama pull bge-m3`、Milvus 容器运行（`docker ps` 看 medibrain-milvus）；② 集群部署：`EMBEDDING_BASE_URL` 需指向宿主机 Ollama（Windows 宿主机用 `host.docker.internal:11434`，Linux 用宿主机 IP），Pod 无法直连 `localhost:11434`；③ 检查 .env 中 `EMBEDDING_MODEL` 未被误设为阿里云模型（本地无 key 时会失败并静默降级） |
| 集群内 Ollama 不可达 | 宿主机 Ollama 默认只监听 127.0.0.1，需设环境变量 `OLLAMA_HOST=0.0.0.0` 后重启（`setx OLLAMA_HOST 0.0.0.0` + 重启 ollama.exe）；kind 集群 Pod 内 `host.docker.internal` 可直接解析宿主机（无需 hostAliases），真实集群需 hostAliases 指向宿主机 IP |

## 七、图谱数据迁移

本机开发库 → 集群 Neo4j 迁移，见 `scripts/graph-migration/README.md`。

## 八、密钥清单

| 环境变量 | 位置 | 说明 |
|----------|------|------|
| JWT_SECRET | Secret | 生产必须更换 |
| DEEPSEEK_API_KEY / BAILIAN_API_KEY | Secret | 使用对应云端 provider 时配置；Ollama 无需 API Key |
| NEO4J_AUTH | Secret | neo4j/密码 |
| MONGO_URI/REDIS_HOST 等 | ConfigMap | 非敏感配置 |
