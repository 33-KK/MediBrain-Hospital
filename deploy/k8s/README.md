# MediBrain-Hospital K8s 部署方案（企业级）

> 提供可直接用于真实集群的 K8s 制品。本地可用 `kind` / `k3d` / Docker Desktop K8s 验证。

## 目录结构

```
deploy/k8s/
├── namespace.yaml          # medibrain 命名空间
├── configmap.yaml          # 非敏感环境配置
├── secret.yaml             # 密钥（JWT/LLM/Neo4j，生产必须替换）
├── server/                 # 后端 Deployment + Service + HPA（自动伸缩 2~10 副本）
├── web/                    # 前端 Deployment + Service + Ingress（nginx 静态服务）
└── infra/                  # Mongo(StatefulSet) / Redis / Neo4j(StatefulSet)
```

## 部署步骤

```bash
# 1. 构建镜像（或在 CI 中推送 registry 后改用 registry 镜像）
docker build -f deploy/docker/server.Dockerfile -t medibrain-server:latest .
docker build -f deploy/docker/web.Dockerfile    -t medibrain-web:latest .

# 2. 创建命名空间并应用清单
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/infra/       # Mongo/Redis/Neo4j
kubectl apply -f deploy/k8s/configmap.yaml
kubectl apply -f deploy/k8s/secret.yaml  # ⚠️ 替换为真实密钥
kubectl apply -f deploy/k8s/server/
kubectl apply -f deploy/k8s/web/

# 3. 验证
kubectl -n medibrain get pods
kubectl -n medibrain rollout status deployment/medibrain-server
kubectl -n medibrain get hpa
```

## 说明

- **镜像**：CI 构建后 `kubectl set image` 触发滚动更新（见根目录 Jenkinsfile）
- **持久化**：Mongo/Neo4j 使用 StatefulSet + PVC（10Gi），Redis 无状态可换云托管
- **入口**：Ingress（nginx-controller），域名 `medibrain.local`，`/api` 反代后端
- **生产注意**：`secret.yaml` 中的密钥仅用于本地演示，生产环境通过 Vault / External Secrets 注入
