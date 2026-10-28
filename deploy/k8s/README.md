# MediBrain-Hospital K8s 部署方案（企业级）

> 提供可直接用于真实集群的 K8s 制品。本地可用 `kind` / `k3d` / Docker Desktop K8s 验证。

## 目录结构

```
deploy/k8s/
├── namespace.yaml          # medibrain 命名空间
├── configmap.yaml          # 非敏感环境配置
├── secret.yaml             # 占位模板，禁止直接应用到现有集群
├── secret.local.yaml       # 本机真实密钥，Git 忽略
├── server/                 # 后端 Deployment + Service + HPA（自动伸缩 2~10 副本）
├── web/                    # 前端 Deployment + Service + Ingress（nginx 静态服务）
└── infra/                  # Mongo(StatefulSet) / Redis / Neo4j(StatefulSet)
```

## 部署步骤

```bash
# 1. 构建镜像（或在 CI 中推送 registry 后改用 registry 镜像）
docker build -f deploy/docker/server.Dockerfile -t medibrain-server:review-v2-20261008 .
docker build -f deploy/docker/web.Dockerfile    -t medibrain-web:review-20261008 .

# 2. 创建命名空间并应用清单
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/configmap.yaml
kubectl apply -f deploy/k8s/secret.local.yaml  # 首次创建时填好真实配置；已有集群不要覆盖当前 Secret
kubectl apply -f deploy/k8s/infra/       # Mongo/Redis/Neo4j
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
- **密钥**：`secret.yaml` 只含占位符。首次创建时复制到已忽略的 `secret.local.yaml` 并填好配置，或通过 Vault / External Secrets 注入；已有集群不要重新应用模板。MongoDB 空数据卷需要先初始化真实用户，单独写 URI 不会创建数据库账号。
- **kind 本机**：加载两个镜像到 `medibrain-prod` 后发布，运行 `scripts/maintenance/start-local-access.ps1`，访问 http://localhost:8090。
